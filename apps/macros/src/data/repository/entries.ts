import { dayKey, dayKeyOffset } from '@tracker-engine/core'
import { syncStamp, touch } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import {
  EMPTY_NUTRIENTS,
  type Food,
  type LogEntry,
  type MealSlot,
  type Nutrients,
  type Venue,
} from '@/domain/types'
import { nutrientsFor, portionFor, scale as scaleNutrients } from '@/lib/nutrition'
import { getFood } from './foods'
import { activeUserId, alive, byRecency, isLater, nextSortIndex, noonOf } from './internal'

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
export async function currentStreak(now = Date.now()): Promise<number> {
  const today = dayKey(now)
  let expected = today
  let count = 0
  let broken = false
  await db.logEntries
    .where('day')
    .belowOrEqual(today)
    .reverse()
    .filter(alive)
    .until(() => broken)
    .each((entry) => {
      if (count > 0 && entry.day === dayKeyOffset(noonOf(expected), -1)) return
      if (entry.day === expected || (count === 0 && entry.day === dayKeyOffset(now, 1))) {
        count += 1
        expected = dayKeyOffset(noonOf(entry.day), 1)
        return
      }
      broken = true
    })
  return count
}

export async function loggedDays(): Promise<string[]> {
  const days = new Set<string>()
  await db.logEntries.filter(alive).each((entry) => days.add(entry.day))
  return [...days].sort()
}

/** What "your data comes with you" actually refers to. */
export const countLoggedDays = async (): Promise<number> => (await loggedDays()).length

/**
 * How much of this food you had last time.
 *
 * The single biggest reason logging in MyFitnessPal feels fast: the amount is already right. Someone
 * who eats 180 g of chicken every day should not be typing 180 every day, and a database default of
 * "100 g" or "1 serving" is wrong for almost everybody on almost every food.
 *
 * Returns the portion the last entry used when it used one, so "2 slices" stays "2 slices" rather
 * than collapsing into the grams it happened to come to.
 */
export interface LastAmount {
  grams: number
  portionId: string | null
  portionCount: number | null
}

export async function lastAmountFor(foodId: string): Promise<LastAmount | null> {
  const rows = await db.logEntries.where('foodId').equals(foodId).filter(alive).toArray()
  const usable = rows.filter((row) => row.grams > 0).sort(byRecency)
  const latest = usable[usable.length - 1]
  if (!latest) return null
  return {
    grams: latest.grams,
    portionId: latest.portionId,
    portionCount: latest.portionCount,
  }
}

/** The same, for a whole list — one pass instead of a query per food. */
export async function lastAmountsFor(
  foodIds: readonly string[],
): Promise<Map<string, LastAmount>> {
  const best = new Map<string, LogEntry>()
  if (foodIds.length === 0) return new Map()
  await db.logEntries.where('foodId').anyOf([...foodIds]).filter(alive).each((entry) => {
    if (!entry.foodId || entry.grams <= 0) return
    const current = best.get(entry.foodId)
    if (!current || isLater(entry, current)) best.set(entry.foodId, entry)
  })
  return new Map(
    [...best].map(([id, entry]) => [
      id,
      { grams: entry.grams, portionId: entry.portionId, portionCount: entry.portionCount },
    ]),
  )
}

/**
 * Logs several foods at once, each at the amount it was last eaten in.
 *
 * The multi-select path. Ticking four things off a frequents list and tapping once is how a daily
 * log gets kept; four separate search → portion → log round trips is how one gets abandoned.
 */
export async function logFoods(
  foods: readonly Food[],
  target: { meal: MealSlot; eatenAt: number; venue: Venue | null },
): Promise<number> {
  const amounts = await lastAmountsFor(foods.map((food) => food.id))
  for (const food of foods) {
    const last = amounts.get(food.id)
    await logFood({
      food,
      meal: target.meal,
      eatenAt: target.eatenAt,
      venue: target.venue,
      source: 'search',
      ...(last
        ? last.portionId !== null
          ? { portionId: last.portionId, portionCount: last.portionCount ?? 1 }
          : { grams: last.grams }
        : {}),
    })
  }
  return foods.length
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
  venue?: Venue | null
  /** Set when this food came out of a recipe logged as ingredients. */
  fromRecipeId?: string | null
  /** Set when this row is one part of a dish — see `LogEntry.dishId`. */
  dishId?: string | null
  dishName?: string | null
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
    sortIndex: nextSortIndex(eatenAt),
    foodId: input.food.id,
    recipeId: null,
    quickAdd: null,
    fromRecipeId: input.fromRecipeId ?? null,
    dishId: input.dishId ?? null,
    dishName: input.dishName ?? null,
    grams,
    portionId: input.grams !== undefined ? null : (portion?.id ?? null),
    portionCount: input.grams !== undefined ? null : count,
    nutrients: nutrientsFor(input.food, grams),
    source: input.source ?? 'search',
    estimate: input.estimate ?? null,
    venue: input.venue ?? null,
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
  label = 'Calories only',
  eatenAt = Date.now(),
  venue: Venue | null = null,
): Promise<string> {
  const entry: LogEntry = {
    id: newId(),
    userId: activeUserId,
    day: dayKey(eatenAt),
    eatenAt,
    meal,
    sortIndex: nextSortIndex(eatenAt),
    foodId: null,
    recipeId: null,
    quickAdd: { ...EMPTY_NUTRIENTS, ...nutrients },
    fromRecipeId: null,
    dishId: null,
    dishName: null,
    grams: 0,
    portionId: null,
    portionCount: null,
    nutrients: { ...EMPTY_NUTRIENTS, ...nutrients },
    source: 'quick',
    estimate: null,
    venue,
    note: label,
    ...syncStamp(),
  }
  await db.logEntries.put(entry)
  await enqueue('logEntries', entry.id)
  return entry.id
}

/**
 * Re-resolves nutrients when the amount changes, keeping the portion the user thinks in.
 *
 * It used to clear `portionId`/`portionCount` unconditionally, so nudging "2 slices · 56 g" up to
 * three slices turned the row into a bare "84g" — and `lastAmountFor`, which is the thing that makes
 * logging fast, then offered 84 g of bread forever after instead of 3 slices. Correcting an amount is
 * the most common edit in the app, so it must not degrade the row it corrects.
 */
export async function updateEntryAmount(id: string, grams: number): Promise<void> {
  const entry = await db.logEntries.get(id)
  if (!entry) return
  const food = entry.foodId ? await getFood(entry.foodId) : undefined
  const portion = food && entry.portionId ? portionFor(food, entry.portionId) : null
  await patch('logEntries', id, {
    grams,
    // Kept only when the new amount is a whole-ish number of the portion the row already used;
    // otherwise the label would claim a count the grams don't match.
    ...(portion && portion.grams > 0 && Math.abs((grams / portion.grams) % 1) < 0.02
      ? { portionId: portion.id, portionCount: Math.round(grams / portion.grams) }
      : { portionId: null, portionCount: null }),
    nutrients: food ? nutrientsFor(food, grams) : entry.nutrients,
  })
}

/**
 * Corrects the macros on a row with no food behind it.
 *
 * Every screen that showed a quick add used to apologise for it — "a quick add has no food behind
 * it, so its amount can't be rescaled" — which is a sentence about `quickAdd` being non-null, not
 * about the user's dinner. A quick add *is* four numbers, so the four numbers are editable, and the
 * apology is gone from all three places it appeared.
 */
export async function updateQuickAdd(
  id: string,
  nutrients: Partial<Nutrients>,
  label?: string,
): Promise<void> {
  const entry = await db.logEntries.get(id)
  if (!entry || entry.quickAdd === null) return
  const next = { ...entry.quickAdd, ...nutrients }
  await patch('logEntries', id, {
    quickAdd: next,
    nutrients: next,
    ...(label === undefined ? {} : { note: label.trim() || 'Calories only' }),
  })
}

export function moveEntry(id: string, meal: MealSlot): Promise<void> {
  return patch('logEntries', id, { meal })
}

/**
 * Corrects where a sitting was eaten — every row in it, not just the one tapped.
 *
 * Venue belongs to the occasion, not the food: you did not eat the chips out and the burger at
 * home. Fixing one item and leaving its five siblings behind is how a "where you eat" chart ends up
 * reporting a single meal as three-fifths home.
 */
export async function setVenue(ids: readonly string[], venue: Venue | null): Promise<void> {
  for (const id of ids) await patch('logEntries', id, { venue })
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

/**
 * Puts a day back exactly as it was.
 *
 * The day editor writes every change immediately — a draft that only commits on "Save" can be lost
 * by a back-swipe, and losing a correction is worse than not offering to discard one. So "revert"
 * is implemented against a snapshot taken when the screen opened: rows that were edited go back to
 * their old values, rows that were deleted come back with their original ids, and rows added since
 * are tombstoned.
 *
 * `clientRev` advances on every restored row rather than being restored too. The revert is a real
 * change as far as sync is concerned; rewinding the revision would let another device's older copy
 * win the merge and undo the undo.
 */
export async function restoreDay(
  day: string,
  snapshot: readonly LogEntry[],
  /** When the snapshot was taken. Only rows created after it are treated as additions. */
  takenAt: number,
): Promise<void> {
  const keep = new Set(snapshot.map((entry) => entry.id))

  for (const entry of snapshot) {
    const current = await db.logEntries.get(entry.id)
    await db.logEntries.put({
      ...entry,
      ...touch(current?.clientRev ?? entry.clientRev),
      deletedAt: null,
    })
    await enqueue('logEntries', entry.id)
  }

  // Anything on the day that isn't in the snapshot *and* was created after it was added while the
  // screen was open. The `createdAt` test matters: a row moved in from another day is also absent
  // from the snapshot, and tombstoning it would destroy data the user never asked to delete. Its
  // new time stays put, which is a smaller wrong than losing the row.
  const days = new Set([day, ...snapshot.map((entry) => entry.day)])
  for (const each of days) {
    for (const entry of await entriesForDay(each)) {
      if (!keep.has(entry.id) && entry.createdAt >= takenAt) {
        await patch('logEntries', entry.id, { deletedAt: Date.now() })
      }
    }
  }
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
 * were eaten in. `at` overrides that when the user has picked a time; `multiple` scales the whole
 * meal, for the half or double portion.
 */
export async function relogEntries(
  entries: readonly LogEntry[],
  into: { day?: string; meal?: MealSlot; at?: number; multiple?: number; venue?: Venue | null } = {},
): Promise<number> {
  const multiple = into.multiple ?? 1
  const day = into.at !== undefined ? dayKey(into.at) : (into.day ?? dayKey(Date.now()))
  // Dishes keep their name and get a fresh id. Reusing the old one would make yesterday's tacos and
  // today's the same dish, so "log this dish again" would then re-log both sittings.
  const dishIds = new Map<string, string>()
  for (const entry of entries) {
    const eatenAt = into.at ?? Date.parse(`${day}T00:00:00`) + minutesIntoDay(entry.eatenAt) * 60_000
    const copy: LogEntry = {
      ...entry,
      id: newId(),
      userId: activeUserId,
      day,
      meal: into.meal ?? entry.meal,
      eatenAt,
      sortIndex: nextSortIndex(eatenAt),
      grams: entry.grams * multiple,
      nutrients: scaleNutrients(entry.nutrients, multiple),
      quickAdd: entry.quickAdd === null ? null : scaleNutrients(entry.quickAdd, multiple),
      dishId: dishIdFor(entry, dishIds),
      source: 'copy',
      // The old venue carries over unless told otherwise: repeating Friday's takeaway is still
      // takeaway, and that is the more often correct guess than blanking it.
      venue: into.venue === undefined ? entry.venue : into.venue,
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

/**
 * A new dish id, for a caller assembling one from several writes.
 *
 * Exported so `EstimateReview` can stamp its rows without knowing how ids are made — the alternative
 * was passing `newId` out of the outbox module, which is not something a screen should reach for.
 */
export const newDishId = (): string => newId()

/** One fresh dish id per source dish, so a copied dish stays one dish. */
function dishIdFor(entry: LogEntry, minted: Map<string, string>): string | null {
  if (entry.dishId === null) return null
  const existing = minted.get(entry.dishId)
  if (existing) return existing
  const next = newId()
  minted.set(entry.dishId, next)
  return next
}

/**
 * Logs a dish again, exactly as it was eaten, at a new time.
 *
 * "I had another one of those" is the whole point of naming a dish. Without it, having the same
 * described meal twice means describing it twice and spending a second model request on a question
 * already answered.
 */
export async function logDishAgain(
  dishId: string,
  into: { meal?: MealSlot; at?: number; multiple?: number } = {},
): Promise<number> {
  const rows = (await db.logEntries.where('dishId').equals(dishId).filter(alive).toArray()).sort(
    (a, b) => a.sortIndex - b.sortIndex,
  )
  if (rows.length === 0) return 0
  return relogEntries(rows, { at: into.at ?? Date.now(), meal: into.meal, multiple: into.multiple })
}

/** The rows one dish was written as, in the order they were written. */
export async function dishEntries(dishId: string): Promise<LogEntry[]> {
  const rows = await db.logEntries.where('dishId').equals(dishId).filter(alive).toArray()
  return rows.sort((a, b) => a.sortIndex - b.sortIndex)
}

/** Removes a whole dish — every row it was logged as, in one action. */
export async function deleteDish(dishId: string): Promise<number> {
  const rows = await db.logEntries.where('dishId').equals(dishId).filter(alive).toArray()
  for (const row of rows) await patch('logEntries', row.id, { deletedAt: Date.now() })
  return rows.length
}
