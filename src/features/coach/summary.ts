/**
 * The de-identified training summary sent to the AI coach (§13, §2).
 *
 * **The privacy contract.** The design constraint is absolute: never send raw
 * rows, never send anything identifying. This module builds a compact aggregate
 * — per-exercise and per-week — that carries *no* name, email, notes, or
 * absolute dates. Dates are reduced to **week offsets** (0 = current week, −1 =
 * last week), so nothing here can be tied back to a calendar or a person.
 *
 * It's also what shrinks the prompt from tens of thousands of tokens to a few
 * thousand, which is what makes the free tier viable and the advice focused.
 *
 * Exercise names ("Barbell Bench Press") are kept — they're the vocabulary the
 * advice needs and identify no one. Free-text notes are dropped.
 *
 * Pure and total: same rows in, same summary out. The repo wrapper loads; this
 * decides shape, so the contract is unit-testable without a database.
 */

import type { Equipment, MovementPattern, Region } from '@/domain/types'
import { estimatedOneRepMaxKg } from '@/lib/metrics'
import { displayWeightOrNull } from '@/lib/units'

/** How many weeks of history the summary spans. Keeps the prompt bounded. */
export const SUMMARY_WEEKS = 12

/** Bump when the shape changes, so a server prompt can branch if needed. */
export const SUMMARY_VERSION = 2

/** One completed set, reduced to the fields aggregation needs. */
export interface SummarySet {
  weightKg: number | null
  reps: number | null
  rpe: number | null
  durationSeconds: number | null
  distanceM: number | null
}

/** One exercise as it was performed in a session, with its taxonomy. */
export interface SummaryExerciseInstance {
  exerciseId: string
  name: string
  region: Region | undefined
  pattern: MovementPattern
  equipment: Equipment
  isCardio: boolean
  sets: SummarySet[]
}

/** One session, dated only by which week it fell in. */
export interface SummarySession {
  /** Week offset from the current week: 0 = this week, −1 = last week, … */
  weekOffset: number
  exercises: SummaryExerciseInstance[]
}

export interface SummaryInput {
  unitWeight: 'lb' | 'kg'
  unitLength: 'in' | 'cm'
  weeklyWorkoutGoal: number
  /** Current bodyweight in kg, or null if never logged. */
  bodyweightKg: number | null
  /** Height in cm, or null if unset. */
  heightCm: number | null
  /** Free-text training goal, or '' if unset. The one free-text field that
   *  leaves the device — surfaced in the §13 disclosure. */
  trainingGoal: string
  /** Sessions in the window, any order. */
  sessions: SummarySession[]
}

// ── Output shape (what's sent) ───────────────────────────────────────────────

export interface WeekAgg {
  weekOffset: number
  workouts: number
  sets: number
  volumeKg: number
}

export interface ExerciseAgg {
  name: string
  region: Region | undefined
  pattern: MovementPattern
  equipment: Equipment
  sessions: number
  totalSets: number
  /** Best estimated 1RM across the window, kg, or null for cardio/rep-only. */
  bestE1rmKg: number | null
  /** Most recent session's heaviest set, kg, or null. */
  recentTopSetKg: number | null
  /** Typical rep range worked: [min, max] across logged sets, or null. */
  repRange: [number, number] | null
  /** Most recent week offset this exercise was trained. */
  lastWeekOffset: number
}

export interface CoachSummary {
  version: number
  unitWeight: 'lb' | 'kg'
  weeklyWorkoutGoal: number
  /** Current bodyweight in the user's unit, rounded, or null if never logged. */
  bodyweight: number | null
  /** Height in the user's length unit (in or cm), rounded, or null if unset. */
  height: number | null
  /** The length unit `height` is expressed in, so the prompt reads correctly. */
  heightUnit: 'in' | 'cm'
  /** Free-text goal, or '' if unset. Drives tailoring; shown in the disclosure. */
  trainingGoal: string
  weeksCovered: number
  totalWorkouts: number
  /** Per-week rollup, most recent first. */
  weeks: WeekAgg[]
  /** Working sets per region over the window, most-trained first. */
  regionSets: { region: Region; sets: number }[]
  /** Per-exercise rollup, most-trained first. */
  exercises: ExerciseAgg[]
}

/**
 * Whether a set carries any logged value. Distinct from `metrics.isWorkingSet`
 * (which means "was performed" via `isCompleted`): the summary is only ever fed
 * already-completed sets, so here the question is just "is this row non-empty",
 * guarding a set with no numbers from inflating counts. Named `hasValue` rather
 * than `isWorkingSet` so it isn't mistaken for the canonical volume predicate.
 */
function hasValue(s: SummarySet): boolean {
  return s.reps !== null || s.durationSeconds !== null || s.distanceM !== null
}

/** Σ weight×reps for the loaded sets. Bodyweight/cardio contribute nothing here
 *  — the summary reports strength via e1RM and top set, tonnage via this. */
function volumeOf(sets: SummarySet[]): number {
  let total = 0
  for (const s of sets) {
    if (s.weightKg !== null && s.reps !== null) total += s.weightKg * s.reps
  }
  return total
}

export function buildCoachSummary(input: SummaryInput): CoachSummary {
  const { sessions } = input

  // Per-week rollup.
  const weekMap = new Map<number, WeekAgg>()
  // Per-region set counts.
  const regionMap = new Map<Region, number>()
  // Per-exercise accumulation.
  const exMap = new Map<
    string,
    {
      name: string
      region: Region | undefined
      pattern: MovementPattern
      equipment: Equipment
      isCardio: boolean
      sessions: number
      totalSets: number
      bestE1rmKg: number | null
      recentTopSetKg: number | null
      recentWeek: number
      repMin: number | null
      repMax: number | null
    }
  >()

  for (const session of sessions) {
    const week = weekMap.get(session.weekOffset) ?? {
      weekOffset: session.weekOffset,
      workouts: 0,
      sets: 0,
      volumeKg: 0,
    }
    week.workouts += 1

    for (const ex of session.exercises) {
      const working = ex.sets.filter(hasValue)
      if (working.length === 0) continue

      week.sets += working.length
      week.volumeKg += volumeOf(working)
      if (ex.region)
        regionMap.set(ex.region, (regionMap.get(ex.region) ?? 0) + working.length)

      const acc = exMap.get(ex.exerciseId) ?? {
        name: ex.name,
        region: ex.region,
        pattern: ex.pattern,
        equipment: ex.equipment,
        isCardio: ex.isCardio,
        sessions: 0,
        totalSets: 0,
        bestE1rmKg: null as number | null,
        recentTopSetKg: null as number | null,
        recentWeek: -Infinity,
        repMin: null as number | null,
        repMax: null as number | null,
      }
      acc.sessions += 1
      acc.totalSets += working.length

      for (const s of working) {
        const e1rm = estimatedOneRepMaxKg(s.weightKg, s.reps)
        if (e1rm !== null && (acc.bestE1rmKg === null || e1rm > acc.bestE1rmKg)) {
          acc.bestE1rmKg = e1rm
        }
        if (s.reps !== null) {
          acc.repMin = acc.repMin === null ? s.reps : Math.min(acc.repMin, s.reps)
          acc.repMax = acc.repMax === null ? s.reps : Math.max(acc.repMax, s.reps)
        }
      }

      // The most recent session's heaviest set. A later week (higher offset,
      // closer to 0) wins; within it, take the max weight.
      if (session.weekOffset >= acc.recentWeek) {
        const topThisSession = Math.max(
          ...working.map((s) => s.weightKg ?? -Infinity),
          acc.recentWeek === session.weekOffset
            ? (acc.recentTopSetKg ?? -Infinity)
            : -Infinity,
        )
        acc.recentTopSetKg = Number.isFinite(topThisSession) ? topThisSession : null
        acc.recentWeek = session.weekOffset
      }

      exMap.set(ex.exerciseId, acc)
    }

    weekMap.set(session.weekOffset, week)
  }

  const round = (kg: number | null): number | null =>
    kg === null ? null : Math.round(kg * 10) / 10

  const exercises: ExerciseAgg[] = [...exMap.values()]
    .map((a) => ({
      name: a.name,
      region: a.region,
      pattern: a.pattern,
      equipment: a.equipment,
      sessions: a.sessions,
      totalSets: a.totalSets,
      bestE1rmKg: round(a.bestE1rmKg),
      recentTopSetKg: round(a.recentTopSetKg),
      repRange:
        a.repMin !== null && a.repMax !== null
          ? ([a.repMin, a.repMax] as [number, number])
          : null,
      lastWeekOffset: a.recentWeek,
    }))
    .sort((a, b) => b.totalSets - a.totalSets)

  const weeks = [...weekMap.values()]
    .map((w) => ({ ...w, volumeKg: Math.round(w.volumeKg) }))
    .sort((a, b) => b.weekOffset - a.weekOffset)

  const regionSets = [...regionMap.entries()]
    .map(([region, sets]) => ({ region, sets }))
    .sort((a, b) => b.sets - a.sets)

  // Bodyweight and height are stored metric; express them in the user's units
  // (lb/kg, in/cm) so the coach reads them the way the user does.
  const bodyweight = displayWeightOrNull(input.bodyweightKg, input.unitWeight)
  const height =
    input.heightCm === null
      ? null
      : input.unitLength === 'in'
        ? Math.round((input.heightCm / 2.54) * 10) / 10
        : Math.round(input.heightCm)

  return {
    version: SUMMARY_VERSION,
    unitWeight: input.unitWeight,
    weeklyWorkoutGoal: input.weeklyWorkoutGoal,
    bodyweight,
    height,
    heightUnit: input.unitLength,
    trainingGoal: input.trainingGoal.trim(),
    weeksCovered: SUMMARY_WEEKS,
    totalWorkouts: sessions.length,
    weeks,
    regionSets,
    exercises,
  }
}
