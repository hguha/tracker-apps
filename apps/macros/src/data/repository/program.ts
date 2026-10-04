import { DAY_MS, dayKey, dayKeyOffset, dayNoon } from '@tracker-engine/core'
import { syncStamp } from '@tracker-engine/local-first'
import { weightTrend, type TrendPoint } from '@tracker-engine/body'
import { db } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import { type CheckIn, type CoachingMode, type MacroTargets, type Program } from '@/domain/types'
import { cycleDayTargets } from '@/lib/nutrition'
import { multiplierForDay } from '@/lib/cycling'
import {
  buildCheckIn,
  initialTargetsFromTrend,
  lastCompleteWeekKey,
  weekKeyForDay,
  type CheckInOutcome,
} from '@/lib/checkin'
import type { IntakeDay } from '@/lib/expenditure'
import { weights } from './body'
import { entriesBetween } from './entries'
import { activeUserId, alive } from './internal'
import { getProfile } from './profile'

export async function activeProgram(): Promise<Program | undefined> {
  const all = await db.programs.filter((p) => alive(p) && p.endedAt === null).toArray()
  return all.map(withGoalFields).sort((a, b) => b.startedAt - a.startedAt)[0]
}

/** Past and present programs, newest first — what a diet break needs to know what to resume. */
export async function programHistory(): Promise<Program[]> {
  const all = await db.programs.filter(alive).toArray()
  return all.map(withGoalFields).sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * A nullable field added to a live store has two empty values, and `undefined === null` is false.
 *
 * The Dexie v4 upgrade backfills local rows, but a row can still arrive from sync written by an
 * older client, so every read normalises as well. Belt and braces on purpose: the failure this
 * prevents is `NaN lb goal` on the home screen, which is the kind of thing a user reports rather
 * than a test catches.
 */
const withGoalFields = (program: Program): Program => ({
  ...program,
  targetKg: program.targetKg ?? null,
  startKg: program.startKg ?? null,
  reachedAt: program.reachedAt ?? null,
})

export async function startProgram(
  input: Pick<Program, 'goal' | 'ratePctPerWeek' | 'proteinGPerKg' | 'fatMinPctKcal'> &
    Partial<Pick<Program, 'coachingMode' | 'cycling' | 'targetKg'>>,
): Promise<string> {
  const current = await activeProgram()
  if (current) await patch('programs', current.id, { endedAt: Date.now() })

  // The trend now, so progress toward a target has a denominator. Captured at the start because it
  // is a fact about when the goal was set, and re-deriving it later would move the goalposts.
  const trend = weightTrend(await weights())

  const program: Program = {
    id: newId(),
    userId: activeUserId,
    startedAt: Date.now(),
    endedAt: null,
    ...input,
    coachingMode: input.coachingMode ?? 'coached',
    cycling: input.cycling ?? null,
    targetKg: input.targetKg ?? null,
    startKg: trend[trend.length - 1]?.trendKg ?? null,
    reachedAt: null,
    ...syncStamp(),
  }
  await db.programs.put(program)
  await enqueue('programs', program.id)
  return program.id
}

export function setCoachingMode(programId: string, coachingMode: CoachingMode): Promise<void> {
  return patch('programs', programId, { coachingMode })
}

/** Tuning an existing program in place. Changing the *goal* starts a new one instead, so the
 *  check-in history stays attributable to the program it was measured under. */
export function setProgramFields(
  programId: string,
  changes: Partial<
    Pick<
      Program,
      'ratePctPerWeek' | 'proteinGPerKg' | 'fatMinPctKcal' | 'cycling' | 'targetKg' | 'reachedAt'
    >
  >,
): Promise<void> {
  return patch('programs', programId, changes)
}

/**
 * Sets the weight this program is aiming at, and re-baselines progress on today's trend.
 *
 * Re-baselining is the point: moving the target should restart the bar, not leave it showing
 * progress toward a number that is no longer the goal.
 */
export async function setGoalWeight(programId: string, targetKg: number | null): Promise<void> {
  const trend = weightTrend(await weights())
  await patch('programs', programId, {
    targetKg,
    startKg: trend[trend.length - 1]?.trendKg ?? null,
    reachedAt: null,
  })
}

/** Records that the target was met, so it can be marked once and then moved on from. */
export function markGoalReached(programId: string, at = Date.now()): Promise<void> {
  return patch('programs', programId, { reachedAt: at })
}

export function checkIns(): Promise<CheckIn[]> {
  return db.checkIns.filter(alive).toArray()
}

export async function latestCheckIn(): Promise<CheckIn | undefined> {
  const all = await checkIns()
  return all.sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0]
}

type CheckInInput = Omit<
  CheckIn,
  'id' | 'userId' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'clientRev'
>

/**
 * Derived from (user, week) for the same reason weigh-ins are: the table has a unique index on
 * that pair, and the sync engine upserts on `id` alone. A random id lets a second device insert
 * a duplicate week and the push 409s against the index, dead-lettering with nothing on screen to
 * explain it.
 *
 * Rule of thumb for this schema: any table with a unique constraint on a natural key must derive
 * its id from that key.
 */
export const checkInIdFor = (userId: string, weekStart: string): string =>
  `ci:${userId}:${weekStart}`

export async function saveCheckIn(input: CheckInInput): Promise<string> {
  const id = checkInIdFor(activeUserId, input.weekStart)
  const existing = (await db.checkIns.get(id)) ?? (await checkIns()).find((c) => c.weekStart === input.weekStart)

  if (existing) {
    if (existing.id === id) {
      await patch('checkIns', id, { ...input })
      return id
    }
    await patch('checkIns', existing.id, { deletedAt: Date.now() })
  }

  const row: CheckIn = { id, userId: activeUserId, ...input, ...syncStamp() }
  await db.checkIns.put(row)
  await enqueue('checkIns', row.id)
  return row.id
}

/**
 * The targets that were in force on each of `days`.
 *
 * A check-in for week W is drawn at the end of that week, so it governs everything after it —
 * which is why the lookup is "newest applied check-in before this day's week" rather than
 * "newest overall". Scoring every past day against today's target is what makes changing a
 * goal appear to rewrite history: yesterday's 2,300 kcal was not over a target that only
 * exists now.
 */
export async function targetsByDay(
  days: readonly string[],
): Promise<Map<string, MacroTargets | null>> {
  const applied = (await checkIns())
    .filter((c) => c.status === 'applied')
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
  const program = await activeProgram()
  const profile = await getProfile()
  // Smoothed once. Inside the loop this was O(days × weigh-ins) for every day before the first
  // check-in, and every pass produced the same trend.
  const trend = weightTrend(await weights())

  const out = new Map<string, MacroTargets | null>()
  // Cycling redistributes a week's calories without changing its total, so it's applied on top of
  // whatever the check-in set rather than being part of it.
  const cycled = (day: string, targets: MacroTargets | null) =>
    targets === null
      ? null
      : cycleDayTargets(targets, multiplierForDay(program?.cycling ?? null, day))

  for (const day of days) {
    // Typed-in targets win outright, from the day they were set. Not cycled either: calorie cycling
    // redistributes a number the app worked out, and a number somebody chose is the number they meant.
    if (profile.manualTargets && day >= profile.manualTargets.fromDay) {
      const { kcal, proteinMg, carbsMg, fatMg } = profile.manualTargets
      out.set(day, { kcal, proteinMg, carbsMg, fatMg })
      continue
    }
    const week = weekKeyForDay(day)
    const inForce = applied.find((c) => c.weekStart < week)
    if (inForce) {
      out.set(day, cycled(day, inForce.targets))
      continue
    }
    // Before the first check-in, the cold-start estimate — from the weight known *then*, so a
    // day early in a cut isn't judged against the target its final weight would imply.
    const trendKg = trendOn(trend, day)
    out.set(
      day,
      cycled(
        day,
        program && trendKg !== null
          ? initialTargetsFromTrend(program, profile, trendKg, dayNoon(day))
          : null,
      ),
    )
  }
  return out
}

/** The trend as of a day: the last smoothed point at or before it. */
function trendOn(trend: readonly TrendPoint[], day: string): number | null {
  let latest: number | null = null
  for (const point of trend) {
    if (point.day > day) break
    latest = point.trendKg
  }
  return latest
}

async function targetsForDay(day: string): Promise<MacroTargets | null> {
  return (await targetsByDay([day])).get(day) ?? null
}

/** Today's targets. Null only when there's nothing to go on at all. */
export function currentTargets(): Promise<MacroTargets | null> {
  return targetsForDay(dayKey(Date.now()))
}

/** Calories logged per day over a window, days with nothing logged omitted. */
export async function intakeByDay(fromDay: string, toDay: string): Promise<IntakeDay[]> {
  const entries = await entriesBetween(fromDay, toDay)
  const totals = new Map<string, number>()
  for (const entry of entries) {
    totals.set(entry.day, (totals.get(entry.day) ?? 0) + entry.nutrients.kcal)
  }
  return [...totals.entries()]
    .map(([day, kcal]) => ({ day, kcal }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * Recalculates the week that just ended, and saves the result.
 *
 * Idempotent per week: re-running replaces that week's row rather than appending, so opening
 * the app twice on a Monday can't produce two conflicting conclusions. Returns null when there
 * is already a check-in for the week (unless forced), or not enough data to draw one.
 *
 * `force` exists because "why hasn't my target moved?" is otherwise unanswerable — it recomputes
 * and overwrites the week, which is safe precisely because the id is derived from it.
 */
export async function runCheckIn(
  now = Date.now(),
  { force = false }: { force?: boolean } = {},
): Promise<CheckIn | null> {
  const outcome = await draftCheckIn(now, { force })
  if (outcome === null || outcome.kind !== 'ready') return null

  const id = await saveCheckIn(outcome.draft)
  return (await db.checkIns.get(id)) ?? null
}

/**
 * The check-in the current data would produce, without saving it. Null when there's no program,
 * the user has turned check-ins off, or the week already has one and this isn't a forced run.
 */
async function draftCheckIn(
  now: number,
  { force }: { force: boolean },
): Promise<CheckInOutcome | null> {
  const program = await activeProgram()
  if (!program) return null
  if (program.coachingMode === 'manual' && !force) return null

  const week = lastCompleteWeekKey(now)
  const all = await checkIns()
  if (!force && all.some((c) => c.weekStart === week)) return null

  return buildCheckIn({
    now,
    program,
    profile: await getProfile(),
    weights: await weights(),
    // Eight weeks: enough for the filter to settle, short enough to stay cheap.
    intake: await intakeByDay(dayKeyOffset(now, 56), dayKey(now)),
    prior:
      all
        .filter((c) => c.status === 'applied' && c.weekStart < week)
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0] ?? null,
  })
}

interface CheckInStatus {
  /** The week a check-in would be about: the one that just ended. */
  weekStart: string
  daysLogged: number
  weighIns: number
  /** The check-in already stored for that week, if any. */
  existing: CheckIn | undefined
  coachingMode: CoachingMode | null
  /** What a run right now would produce, or why it can't. */
  outcome: CheckInOutcome | null
}

/**
 * Everything the check-in screen needs to explain itself: which week, what it has to work
 * with, and what a run would conclude. "Not enough data" without the counts is not an
 * explanation — it's the same dead end as a spinner.
 */
export async function checkInStatus(now = Date.now()): Promise<CheckInStatus> {
  const week = lastCompleteWeekKey(now)
  const from = week
  const to = dayKey(dayNoon(week) + 6 * DAY_MS)
  const program = await activeProgram()

  return {
    weekStart: week,
    daysLogged: (await intakeByDay(from, to)).filter((day) => day.kcal > 0).length,
    weighIns: (await weights()).filter((row) => row.day >= from && row.day <= to).length,
    existing: (await checkIns()).find((c) => c.weekStart === week),
    coachingMode: program?.coachingMode ?? null,
    outcome: await draftCheckIn(now, { force: true }),
  }
}

/** The proposal waiting on the user, in collaborative mode. */
export async function pendingCheckIn(): Promise<CheckIn | undefined> {
  return (await checkIns())
    .filter((c) => c.status === 'proposed')
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0]
}

export function applyCheckIn(id: string): Promise<void> {
  return patch('checkIns', id, { status: 'applied' })
}

export function declineCheckIn(id: string): Promise<void> {
  return patch('checkIns', id, { status: 'declined' })
}
