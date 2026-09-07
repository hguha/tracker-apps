import { DAY_MS, dayKey } from '@tracker-engine/core'
import { syncStamp, touch } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import { db, owner } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import {
  EMPTY_NUTRIENTS,
  type BodyWeightRow,
  type CheckIn,
  type CoachingMode,
  type Food,
  type LogEntry,
  type MacroTargets,
  type MealSlot,
  type MealTemplate,
  type MealTemplateItem,
  type Nutrients,
  type DeviceSettings,
  type Profile,
  type Program,
} from '@/domain/types'
import {
  nutrientsFor,
  portionFor,
  scale as scaleNutrients,
  sum as sumNutrients,
} from '@/lib/nutrition'
import { matchesQuery, queryTerms, rankFoods } from '@/lib/foodSearch'
import { buildCheckIn, initialTargets, lastCompleteWeekKey, weekKeyForDay } from '@/lib/checkin'
import type { IntakeDay } from '@/lib/expenditure'

/**
 * The only way features touch storage. Screens never import `@/db` directly, so the write
 * path (stamp, enqueue) can't be bypassed — the rule scripts/check-architecture.mjs enforces.
 */

let activeUserId = LOCAL_USER_ID

export function setActiveUserId(userId: string): void {
  activeUserId = userId
}

export const currentUserId = (): string => activeUserId

// --- Profile (synced, one row per user) -------------------------------------------

function defaultProfile(userId: string): Profile {
  return {
    id: userId,
    displayName: 'You',
    units: 'metric',
    theme: 'default',
    colorScheme: 'system',
    accentOverride: null,
    heightCm: null,
    birthYear: null,
    sex: null,
    onboardedAt: null,
    onboardingVersion: 0,
    dietNotes: '',
    eatingWindow: null,
    ...syncStamp(),
  }
}

/**
 * Read-only, and it must stay that way: this is read from live queries, and Dexie throws
 * "readwrite transaction in liveQuery context" if a querier writes. Returns an unsaved default
 * when there's no row yet; `ensureProfile` is what creates it, from the boot effect.
 */
export async function getProfile(): Promise<Profile> {
  return (await db.profiles.get(activeUserId)) ?? defaultProfile(activeUserId)
}

/** Creates the profile row if absent. Boot-effect only — never call this from a query. */
export async function ensureProfile(): Promise<Profile> {
  const existing = await db.profiles.get(activeUserId)
  if (existing) return existing
  const created = defaultProfile(activeUserId)
  await db.profiles.put(created)
  await enqueue('profiles', created.id)
  return created
}

export async function saveProfile(changes: Partial<Profile>): Promise<void> {
  await ensureProfile()
  await patch('profiles', activeUserId, changes as Record<string, unknown>)
}

// --- Device settings (never synced) -----------------------------------------------

export async function getDeviceSettings(): Promise<DeviceSettings> {
  return (await db.device.get('device')) ?? { id: 'device', reputationGrant: null }
}

export async function saveDeviceSettings(changes: Partial<DeviceSettings>): Promise<void> {
  await db.device.put({ ...(await getDeviceSettings()), ...changes, id: 'device' })
}

// --- Foods (server-authored reference data) ---------------------------------------

export function getFood(id: string): Promise<Food | undefined> {
  return db.foods.get(id)
}

export async function foodsByIds(ids: readonly string[]): Promise<Map<string, Food>> {
  const rows = await db.foods.bulkGet([...new Set(ids)])
  return new Map(rows.filter((f): f is Food => f !== undefined).map((f) => [f.id, f]))
}

export function findByBarcode(barcode: string): Promise<Food | undefined> {
  return db.foods.where('barcode').equals(barcode).first()
}

/** Substring search over everything cached locally, ranked by lib/foodSearch. */
export async function searchFoods(query: string, limit = 40): Promise<Food[]> {
  const terms = queryTerms(query)
  if (query.trim().length < 2) return []

  const matches: Food[] = []
  await db.foods.each((food) => {
    if (matchesQuery(food, terms)) matches.push(food)
  })
  return rankFoods(matches, query, limit)
}

export async function putFoods(foods: readonly Food[]): Promise<void> {
  await db.foods.bulkPut(foods as Food[])
}

// --- Log entries ------------------------------------------------------------------

/** Every surviving entry. Only for lifetime aggregates — screens read a window. */
export function allEntries(): Promise<LogEntry[]> {
  return db.logEntries.filter(alive).toArray()
}

export function entriesForDay(day: string): Promise<LogEntry[]> {
  return db.logEntries.where('day').equals(day).filter(alive).toArray()
}

export async function entriesBetween(fromDay: string, toDay: string): Promise<LogEntry[]> {
  return db.logEntries.where('day').between(fromDay, toDay, true, true).filter(alive).toArray()
}

/** Every day with at least one entry, for streaks and consistency charts. */
export async function loggedDays(): Promise<string[]> {
  const days = new Set<string>()
  await db.logEntries.filter(alive).each((entry) => days.add(entry.day))
  return [...days].sort()
}

/** What "your data comes with you" actually refers to. */
export const countLoggedDays = async (): Promise<number> => (await loggedDays()).length

/** Distinct foods logged most often, for the Log screen's frequents. */
export async function frequentFoodIds(limit = 20): Promise<string[]> {
  const counts = new Map<string, number>()
  await db.logEntries.filter(alive).each((entry) => {
    if (entry.foodId) counts.set(entry.foodId, (counts.get(entry.foodId) ?? 0) + 1)
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

export interface LogFoodInput {
  food: Food
  grams?: number
  portionId?: string | null
  portionCount?: number
  meal: MealSlot
  day?: string
  eatenAt?: number
  note?: string
  source?: LogEntry['source']
  estimate?: LogEntry['estimate']
}

/**
 * Logs a food. Nutrients are resolved here and stored on the row, so a later reference-data
 * update can correct future logs without silently rewriting what someone already ate.
 */
export async function logFood(input: LogFoodInput): Promise<string> {
  const portion = input.portionId === undefined
    ? portionFor(input.food, null)
    : portionFor(input.food, input.portionId)
  const count = input.portionCount ?? 1
  const grams = input.grams ?? (portion ? portion.grams * count : 100)
  const eatenAt = input.eatenAt ?? Date.now()

  const entry: LogEntry = {
    id: newId(),
    userId: activeUserId,
    day: input.day ?? dayKey(eatenAt),
    eatenAt,
    meal: input.meal,
    sortIndex: eatenAt,
    foodId: input.food.id,
    recipeId: null,
    quickAdd: null,
    grams,
    portionId: input.grams !== undefined ? null : (portion?.id ?? null),
    portionCount: input.grams !== undefined ? null : count,
    nutrients: nutrientsFor(input.food, grams),
    source: input.source ?? 'search',
    estimate: input.estimate ?? null,
    note: input.note ?? '',
    ...syncStamp(),
  }

  await db.logEntries.put(entry)
  await enqueue('logEntries', entry.id)
  return entry.id
}

export async function logQuickAdd(
  nutrients: Nutrients,
  meal: MealSlot,
  label = 'Quick add',
  eatenAt = Date.now(),
): Promise<string> {
  const entry: LogEntry = {
    id: newId(),
    userId: activeUserId,
    day: dayKey(eatenAt),
    eatenAt,
    meal,
    sortIndex: eatenAt,
    foodId: null,
    recipeId: null,
    quickAdd: { ...EMPTY_NUTRIENTS, ...nutrients },
    grams: 0,
    portionId: null,
    portionCount: null,
    nutrients: { ...EMPTY_NUTRIENTS, ...nutrients },
    source: 'quick',
    estimate: null,
    note: label,
    ...syncStamp(),
  }
  await db.logEntries.put(entry)
  await enqueue('logEntries', entry.id)
  return entry.id
}

/** Re-resolves nutrients when the amount changes, so the row stays self-consistent. */
export async function updateEntryAmount(id: string, grams: number): Promise<void> {
  const entry = await db.logEntries.get(id)
  if (!entry) return
  const food = entry.foodId ? await db.foods.get(entry.foodId) : undefined
  await patch('logEntries', id, {
    grams,
    portionId: null,
    portionCount: null,
    nutrients: food ? nutrientsFor(food, grams) : entry.nutrients,
  })
}

export function moveEntry(id: string, meal: MealSlot): Promise<void> {
  return patch('logEntries', id, { meal })
}

/**
 * Corrects when something was eaten. `day` and `sortIndex` follow the timestamp, because a row
 * whose day disagrees with its `eatenAt` would be counted on one day and drawn on another.
 */
export function retimeEntry(id: string, eatenAt: number): Promise<void> {
  return patch('logEntries', id, { eatenAt, day: dayKey(eatenAt), sortIndex: eatenAt })
}

export function deleteEntry(id: string): Promise<void> {
  return patch('logEntries', id, { deletedAt: Date.now() })
}

/** Re-logs a whole day into today, the fastest path for someone who eats on repeat. */
export async function copyDay(fromDay: string, toDay: string): Promise<number> {
  return relogEntries(await entriesForDay(fromDay), { day: toDay })
}

/**
 * Re-logs entries, optionally into another day, meal or time.
 *
 * Times are shifted rather than collapsed onto `now`: repeating yesterday's dinner at 19:40
 * should land at 19:40, not stamp four items with the same second and lose the order they
 * were eaten in.
 */
export async function relogEntries(
  entries: readonly LogEntry[],
  into: { day?: string; meal?: MealSlot; at?: number } = {},
): Promise<number> {
  const day = into.day ?? dayKey(Date.now())
  for (const entry of entries) {
    const eatenAt = into.at ?? Date.parse(`${day}T00:00:00`) + minutesIntoDay(entry.eatenAt) * 60_000
    const copy: LogEntry = {
      ...entry,
      id: newId(),
      userId: activeUserId,
      day,
      meal: into.meal ?? entry.meal,
      eatenAt,
      sortIndex: eatenAt,
      source: 'copy',
      ...syncStamp(),
    }
    await db.logEntries.put(copy)
    await enqueue('logEntries', copy.id)
  }
  return entries.length
}

const minutesIntoDay = (at: number): number => {
  const date = new Date(at)
  return date.getHours() * 60 + date.getMinutes()
}

// --- Saved meals ------------------------------------------------------------------

export function mealTemplates(): Promise<MealTemplate[]> {
  return db.mealTemplates.filter(alive).toArray()
}

/**
 * Saves a set of logged entries as a meal to repeat.
 *
 * Nutrients are copied onto the template, not re-derived from the food ids: a saved meal has to
 * keep working when a food row is never re-fetched on a new device, and re-deriving would also
 * let a reference-data correction silently change what "my usual breakfast" means.
 */
export async function saveMealTemplate(
  name: string,
  entries: readonly LogEntry[],
): Promise<string> {
  const items: MealTemplateItem[] = entries.map((entry) => ({
    id: newId(),
    foodId: entry.foodId,
    recipeId: entry.recipeId,
    grams: entry.grams,
    nutrients: entry.nutrients,
  }))
  const template: MealTemplate = {
    id: newId(),
    userId: activeUserId,
    name: name.trim() || 'Saved meal',
    items,
    nutrients: sumNutrients(items.map((item) => item.nutrients)),
    ...syncStamp(),
  }
  await db.mealTemplates.put(template)
  await enqueue('mealTemplates', template.id)
  return template.id
}

export function deleteMealTemplate(id: string): Promise<void> {
  return patch('mealTemplates', id, { deletedAt: Date.now() })
}

/**
 * Logs a saved meal, optionally at a fraction or multiple of the saved amount.
 *
 * The multiplier is what makes a saved meal cover batch cooking: save the whole tray, then log a
 * third of it. Grams and nutrients scale together through lib/nutrition, so a half portion can't
 * end up with full-portion macros.
 */
export async function logMealTemplate(
  template: MealTemplate,
  meal: MealSlot,
  at = Date.now(),
  multiple = 1,
): Promise<number> {
  for (const item of template.items) {
    const entry: LogEntry = {
      id: newId(),
      userId: activeUserId,
      day: dayKey(at),
      eatenAt: at,
      meal,
      sortIndex: at,
      foodId: item.foodId,
      recipeId: item.recipeId,
      quickAdd:
        item.foodId === null && item.recipeId === null
          ? scaleNutrients(item.nutrients, multiple)
          : null,
      grams: item.grams * multiple,
      portionId: null,
      portionCount: null,
      nutrients: scaleNutrients(item.nutrients, multiple),
      source: 'template',
      estimate: null,
      note: template.name,
      ...syncStamp(),
    }
    await db.logEntries.put(entry)
    await enqueue('logEntries', entry.id)
  }
  return template.items.length
}

/** Recently logged meals, newest first — the "eat that again" list. */
export async function recentMeals(days = 14, limit = 12): Promise<RecentMeal[]> {
  const from = dayKey(Date.now() - days * DAY_MS)
  const entries = await entriesBetween(from, dayKey(Date.now()))
  const groups = new Map<string, LogEntry[]>()
  for (const entry of entries) {
    const key = `${entry.day}|${entry.meal}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const [day, meal] = key.split('|') as [string, MealSlot]
      return {
        day,
        meal,
        entries: rows.sort((a, b) => a.sortIndex - b.sortIndex),
        nutrients: sumNutrients(rows.map((row) => row.nutrients)),
      }
    })
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, limit)
}

export interface RecentMeal {
  day: string
  meal: MealSlot
  entries: LogEntry[]
  nutrients: Nutrients
}

// --- Bodyweight -------------------------------------------------------------------

export function weights(): Promise<BodyWeightRow[]> {
  return db.bodyWeights.filter(alive).toArray()
}

/**
 * One weigh-in per day: re-weighing replaces rather than adding, so the trend can't be skewed
 * by stepping on the scale twice.
 *
 * The id is derived from (user, day) rather than random, because that pair *is* the natural key
 * — the table has a unique index on it. With a random id, a device that hadn't yet pulled an
 * existing weigh-in would insert a second row for the same day and the push would 409 against
 * that index, dead-lettering silently. Upserting on a deterministic id makes the write
 * idempotent from any device.
 */
export const weightIdFor = (userId: string, day: string): string => `bw:${userId}:${day}`

export async function recordWeight(kg: number, day = dayKey(Date.now())): Promise<void> {
  const id = weightIdFor(activeUserId, day)
  const existing = (await db.bodyWeights.get(id)) ?? (await byDay(day))

  if (existing) {
    if (existing.id === id) {
      await patch('bodyWeights', id, { kg, source: 'macros', deletedAt: null })
      return
    }
    // A row from before ids were deterministic, or one pulled from another device. Tombstone it
    // so both copies don't count toward the trend.
    await patch('bodyWeights', existing.id, { deletedAt: Date.now() })
  }

  const row: BodyWeightRow = {
    id,
    userId: activeUserId,
    day,
    kg,
    source: 'macros',
    ...syncStamp(),
  }
  await db.bodyWeights.put(row)
  await enqueue('bodyWeights', row.id)
}

const byDay = (day: string) => db.bodyWeights.where('day').equals(day).filter(alive).first()

// --- Program & check-ins ----------------------------------------------------------

export async function activeProgram(): Promise<Program | undefined> {
  const all = await db.programs.filter((p) => alive(p) && p.endedAt === null).toArray()
  return all.sort((a, b) => b.startedAt - a.startedAt)[0]
}

export async function startProgram(
  input: Pick<Program, 'goal' | 'ratePctPerWeek' | 'proteinGPerKg' | 'fatMinPctKcal'> &
    Partial<Pick<Program, 'coachingMode' | 'cycling'>>,
): Promise<string> {
  const current = await activeProgram()
  if (current) await patch('programs', current.id, { endedAt: Date.now() })

  const program: Program = {
    id: newId(),
    userId: activeUserId,
    startedAt: Date.now(),
    endedAt: null,
    coachingMode: input.coachingMode ?? 'coached',
    cycling: input.cycling ?? null,
    ...input,
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
  changes: Partial<Pick<Program, 'ratePctPerWeek' | 'proteinGPerKg' | 'fatMinPctKcal'>>,
): Promise<void> {
  return patch('programs', programId, changes)
}

export function checkIns(): Promise<CheckIn[]> {
  return db.checkIns.filter(alive).toArray()
}

export async function latestCheckIn(): Promise<CheckIn | undefined> {
  const all = await checkIns()
  return all.sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0]
}

export type CheckInInput = Omit<
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
  const allWeights = await weights()

  const out = new Map<string, MacroTargets | null>()
  for (const day of days) {
    const week = weekKeyForDay(day)
    const inForce = applied.find((c) => c.weekStart < week)
    if (inForce) {
      out.set(day, inForce.targets)
      continue
    }
    // Before the first check-in, the cold-start estimate — from the weight known *then*, so a
    // day early in a cut isn't judged against the target its final weight would imply.
    out.set(
      day,
      program
        ? initialTargets(
            program,
            profile,
            allWeights.filter((row) => row.day <= day),
            Date.parse(`${day}T12:00:00`),
          )
        : null,
    )
  }
  return out
}

export async function targetsForDay(day: string): Promise<MacroTargets | null> {
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
 * the app twice on a Monday can't produce two conflicting conclusions. Returns null when
 * there is already a check-in for the week, or not enough data to draw one.
 */
export async function runCheckIn(now = Date.now()): Promise<CheckIn | null> {
  const program = await activeProgram()
  if (!program || program.coachingMode === 'manual') return null

  const week = lastCompleteWeekKey(now)
  const existing = (await checkIns()).find((c) => c.weekStart === week)
  if (existing) return null

  const outcome = buildCheckIn({
    now,
    program,
    profile: await getProfile(),
    weights: await weights(),
    // Eight weeks: enough for the filter to settle, short enough to stay cheap.
    intake: await intakeByDay(dayKey(now - 56 * DAY_MS), dayKey(now)),
    prior: (await checkIns())
      .filter((c) => c.status === 'applied')
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0] ?? null,
  })
  if (outcome.kind !== 'ready') return null

  const id = await saveCheckIn(outcome.draft)
  return (await db.checkIns.get(id)) ?? null
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

// --- Account lifecycle ------------------------------------------------------------

/**
 * Re-owns device-only rows for a real account and re-queues them.
 *
 * Must run *before* `owner.assertOwner`, or the guard sees rows belonging to someone else
 * and wipes exactly what was just claimed.
 */
export async function claimLocalData(userId: string): Promise<number> {
  const tables = [
    ['profiles', db.profiles],
    ['logEntries', db.logEntries],
    ['bodyWeights', db.bodyWeights],
    ['recipes', db.recipes],
    ['mealTemplates', db.mealTemplates],
    ['programs', db.programs],
    ['checkIns', db.checkIns],
  ] as const

  let claimed = 0
  for (const [table, store] of tables) {
    if (table === 'profiles') {
      // The profile's primary key *is* the owner, so it can't be re-owned in place — the row
      // has to be re-keyed, which means delete and re-insert.
      const stale = (await db.profiles.toArray()).filter((row) => row.id !== userId)
      for (const row of stale) {
        const existing = await db.profiles.get(userId)
        if (!existing) {
          await db.profiles.put({ ...row, id: userId, ...touch(row.clientRev) })
          await enqueue('profiles', userId)
          claimed += 1
        }
        await db.profiles.delete(row.id)
      }
      continue
    }
    const rows = await store.where('userId').notEqual(userId).toArray()
    for (const row of rows) {
      await store.update(row.id, { userId, updatedAt: Date.now() })
      await enqueue(table, row.id)
      claimed += 1
    }
  }
  return claimed
}

export const assertDbOwner = (ownerId: string): Promise<boolean> => owner.assertOwner(ownerId)
export const setDbOwner = (ownerId: string): void => owner.setOwner(ownerId)
export const clearDbOwner = (): void => owner.clearOwner()

/** Wipes this device's copy, keeping the seeded food reference data. */
export async function clearLocalData(): Promise<void> {
  await Promise.all([
    db.profiles.clear(),
    db.logEntries.clear(),
    db.bodyWeights.clear(),
    db.recipes.clear(),
    db.mealTemplates.clear(),
    db.programs.clear(),
    db.checkIns.clear(),
    db.outbox.clear(),
    db.deadLetter.clear(),
    db.syncState.clear(),
  ])
}

function alive(row: { deletedAt: number | null }): boolean {
  return row.deletedAt === null
}
