import { dayKey } from '@tracker-engine/core'
import { syncStamp } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import { db, owner } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import {
  EMPTY_NUTRIENTS,
  type BodyWeightRow,
  type CheckIn,
  type Food,
  type LogEntry,
  type MacroTargets,
  type MealSlot,
  type Nutrients,
  type Profile,
  type Program,
} from '@/domain/types'
import { nutrientsFor, portionFor } from '@/lib/nutrition'

/**
 * The only way features touch storage. Screens never import `@/db` directly, so the write
 * path (stamp, enqueue) can't be bypassed — the rule scripts/check-architecture.mjs enforces.
 */

let activeUserId = LOCAL_USER_ID

export function setActiveUserId(userId: string): void {
  activeUserId = userId
}

export const currentUserId = (): string => activeUserId

// --- Profile (device-local) -------------------------------------------------------

const DEFAULT_PROFILE: Profile = {
  id: 'me',
  displayName: 'You',
  units: 'metric',
  theme: 'default',
  colorScheme: 'system',
  heightCm: null,
  birthYear: null,
  sex: null,
  onboardedAt: null,
  reputationGrant: null,
}

export async function getProfile(): Promise<Profile> {
  return (await db.profile.get('me')) ?? DEFAULT_PROFILE
}

export async function saveProfile(changes: Partial<Profile>): Promise<void> {
  const current = await getProfile()
  await db.profile.put({ ...current, ...changes, id: 'me' })
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

/**
 * Offline substring search over the seeded subset. Ranked so a whole-food match beats a
 * branded one: someone typing "chicken breast" wants the ingredient, not a frozen dinner.
 */
export async function searchFoods(query: string, limit = 40): Promise<Food[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const terms = q.split(/\s+/)
  const matches: { food: Food; score: number }[] = []

  await db.foods.each((food) => {
    const haystack = `${food.description} ${food.brand ?? ''}`.toLowerCase()
    if (!terms.every((term) => haystack.includes(term))) return
    let score = 0
    if (haystack.startsWith(q)) score += 10
    if (food.brand === null) score += 4
    if (food.source === 'usda') score += 2
    score -= Math.min(5, food.description.length / 40)
    matches.push({ food, score })
  })

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => m.food)
}

export async function putFoods(foods: readonly Food[]): Promise<void> {
  await db.foods.bulkPut(foods as Food[])
}

// --- Log entries ------------------------------------------------------------------

export function entriesForDay(day: string): Promise<LogEntry[]> {
  return db.logEntries.where('day').equals(day).filter(alive).toArray()
}

export async function entriesBetween(fromDay: string, toDay: string): Promise<LogEntry[]> {
  return db.logEntries.where('day').between(fromDay, toDay, true, true).filter(alive).toArray()
}

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
): Promise<string> {
  const eatenAt = Date.now()
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

export function deleteEntry(id: string): Promise<void> {
  return patch('logEntries', id, { deletedAt: Date.now() })
}

/** Re-logs a whole day into today, the fastest path for someone who eats on repeat. */
export async function copyDay(fromDay: string, toDay: string): Promise<number> {
  const entries = await entriesForDay(fromDay)
  for (const entry of entries) {
    const copy: LogEntry = {
      ...entry,
      id: newId(),
      userId: activeUserId,
      day: toDay,
      eatenAt: Date.now(),
      source: 'copy',
      ...syncStamp(),
    }
    await db.logEntries.put(copy)
    await enqueue('logEntries', copy.id)
  }
  return entries.length
}

// --- Bodyweight -------------------------------------------------------------------

export function weights(): Promise<BodyWeightRow[]> {
  return db.bodyWeights.filter(alive).toArray()
}

/** One weigh-in per day: re-weighing replaces, so the trend can't be skewed by doing it twice. */
export async function recordWeight(kg: number, day = dayKey(Date.now())): Promise<void> {
  const existing = await db.bodyWeights.where('day').equals(day).filter(alive).first()
  if (existing) {
    await patch('bodyWeights', existing.id, { kg, source: 'macros' })
    return
  }
  const row: BodyWeightRow = {
    id: newId(),
    userId: activeUserId,
    day,
    kg,
    source: 'macros',
    ...syncStamp(),
  }
  await db.bodyWeights.put(row)
  await enqueue('bodyWeights', row.id)
}

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

export async function saveCheckIn(input: CheckInInput): Promise<string> {
  const existing = (await checkIns()).find((c) => c.weekStart === input.weekStart)
  if (existing) {
    await patch('checkIns', existing.id, { ...input })
    return existing.id
  }
  const row: CheckIn = { id: newId(), userId: activeUserId, ...input, ...syncStamp() }
  await db.checkIns.put(row)
  await enqueue('checkIns', row.id)
  return row.id
}

/** The targets in force: the newest applied check-in, else nothing yet. */
export async function currentTargets(): Promise<MacroTargets | null> {
  const applied = (await checkIns())
    .filter((c) => c.status === 'applied')
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0]
  return applied?.targets ?? null
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
    ['logEntries', db.logEntries],
    ['bodyWeights', db.bodyWeights],
    ['recipes', db.recipes],
    ['mealTemplates', db.mealTemplates],
    ['programs', db.programs],
    ['checkIns', db.checkIns],
  ] as const

  let claimed = 0
  for (const [table, store] of tables) {
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
