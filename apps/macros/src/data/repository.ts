import { DAY_MS, dayKey, dayKeyOffset } from '@tracker-engine/core'
import { syncStamp, touch } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import { weightTrend, type TrendPoint } from '@tracker-engine/body'
import { db, owner } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import {
  DEFAULT_REMINDERS,
  EMPTY_NUTRIENTS,
  type BodyWeightRow,
  type CuisineKey,
  type CheckIn,
  type CoachingMode,
  type CustomFood,
  type Food,
  type FoodPortion,
  type LogEntry,
  type MacroTargets,
  type MealSlot,
  type MealTemplate,
  type MealTemplateItem,
  type Nutrients,
  type Profile,
  type Program,
  type Recipe,
  type RecipeIngredient,
  type RecipeUsage,
  type RemindersConfig,
  type Venue,
  type WaterRow,
} from '@/domain/types'
import {
  cycleDayTargets,
  nutrientsFor,
  portionFor,
  recipeNutrients,
  scale as scaleNutrients,
  sum as sumNutrients,
} from '@/lib/nutrition'
import { multiplierForDay } from '@/lib/cycling'
import {
  haystackOf,
  matchesHaystack,
  overlapScore,
  queryTerms,
  rankFoods,
} from '@/lib/foodSearch'
import {
  buildCheckIn,
  initialTargetsFromTrend,
  lastCompleteWeekKey,
  weekKeyForDay,
  type CheckInOutcome,
} from '@/lib/checkin'
import type { IntakeDay } from '@/lib/expenditure'

/**
 * The only way features touch storage. Screens never import `@/db` directly, so the write
 * path (stamp, enqueue) can't be bypassed — the rule scripts/check-architecture.mjs enforces.
 */

let activeUserId = LOCAL_USER_ID

export function setActiveUserId(userId: string): void {
  activeUserId = userId
}

/**
 * Where a row sits within its day.
 *
 * The timestamp, plus a counter — because a dish is written as several rows inside the same
 * millisecond, so `sortIndex: eatenAt` gave all of them the same position and left the order to
 * whatever IndexedDB returned. The parts of "3 steak tacos" then listed in a different order on
 * different devices, and a recipe's ingredients came out shuffled from the order they were entered.
 *
 * Milliseconds rather than a separate fraction, so old rows (which stored the bare timestamp) stay
 * comparable with new ones. A shift of under a second cannot reorder anything a person would notice.
 */
let sortSequence = 0

function nextSortIndex(eatenAt: number): number {
  sortSequence = (sortSequence + 1) % 900
  return eatenAt + sortSequence
}

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
    activity: null,
    favouriteFoodIds: [],
    waterTargetMl: null,
    manualTargets: null,
    reminders: null,
    ...syncStamp(),
  }
}

/**
 * Read-only, and it must stay that way: this is read from live queries, and Dexie throws
 * "readwrite transaction in liveQuery context" if a querier writes. Returns an unsaved default
 * when there's no row yet; `ensureProfile` is what creates it, from the boot effect.
 */
export async function getProfile(): Promise<Profile> {
  const row = await db.profiles.get(activeUserId)
  if (!row) return defaultProfile(activeUserId)
  // Fields added after launch are absent on older rows: `.map` on undefined throws, and every
  // `=== null` check reads `undefined` as "set" — the bug that produced `NaN lb goal`.
  return {
    ...row,
    favouriteFoodIds: row.favouriteFoodIds ?? [],
    waterTargetMl: row.waterTargetMl ?? null,
    manualTargets: row.manualTargets ?? null,
    // The weigh-in nudge arrived after the config did, so a row written before it has no such key —
    // and `config.weighIn.enabled` on undefined throws rather than reading as off.
    reminders: row.reminders
      ? { ...row.reminders, weighIn: row.reminders.weighIn ?? DEFAULT_REMINDERS.weighIn }
      : null,
    activity: row.activity ?? null,
  }
}

/**
 * Saves or unsaves a food.
 *
 * Named `toggleSaved` because there is one word for this now. A starred food used to be "pinned" and
 * a kept meal "saved" — two words for one idea, so it was impossible to guess where either would
 * turn up. The stored field keeps its old name; renaming a synced column buys nothing.
 *
 * Newest first, so the list reads as "what I've been eating lately" rather than as an archive, and
 * capped — a saved list of ninety is the frequents list with extra steps.
 */
export async function toggleSaved(foodId: string): Promise<void> {
  const current = (await getProfile()).favouriteFoodIds
  const next = current.includes(foodId)
    ? current.filter((id) => id !== foodId)
    : [foodId, ...current].slice(0, 60)
  await saveProfile({ favouriteFoodIds: next })
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

// --- Foods (server-authored reference data) ---------------------------------------

/**
 * A food by id, from either source.
 *
 * Every read merges reference data with the user's own foods, so nothing downstream — the log,
 * the timeline, recipes, the coach — needs to know which table a `foodId` came from.
 */
export async function getFood(id: string): Promise<Food | undefined> {
  return (await db.foods.get(id)) ?? (await db.customFoods.get(id))
}

export async function foodsByIds(ids: readonly string[]): Promise<Map<string, Food>> {
  const unique = [...new Set(ids)]
  const [reference, custom] = await Promise.all([
    db.foods.bulkGet(unique),
    db.customFoods.bulkGet(unique),
  ])
  const found = [...reference, ...custom].filter((f): f is Food => f !== undefined)
  return new Map(found.map((f) => [f.id, f]))
}

export async function findByBarcode(barcode: string): Promise<Food | undefined> {
  // Own foods first: someone who entered a label the databases got wrong meant to override it.
  return (
    (await db.customFoods.where('barcode').equals(barcode).filter(alive).first()) ??
    (await db.foods.where('barcode').equals(barcode).first())
  )
}

/**
 * An in-memory index of every cached food, built once and reused.
 *
 * `searchFoods` runs on every keystroke through a live query, and it used to walk a Dexie cursor
 * over the whole `foods` table each time. At 46 seeded foods that was free; at 1,462 it is a
 * measurable stall on typing, and `loadDemoData` — 150 lookups in a row — went from fast to timing
 * out. A cursor per keystroke is the wrong shape for this query whatever the row count.
 *
 * Invalidated by every write path, so a newly cached remote food is searchable immediately. The
 * whole point of the local index is that it agrees with the database.
 */
let foodIndex: { rows: IndexedFood[]; size: number } | null = null

/** A cached row with its match text precomputed — see `matchesHaystack`. */
interface IndexedFood {
  food: Food
  haystack: string
}

export function invalidateFoodIndex(): void {
  foodIndex = null
}

/**
 * Every cached food, from memory when it's valid.
 *
 * The `count()` calls are not incidental — they do two jobs and the first one is easy to lose.
 *
 * 1. **They keep the live query alive.** `useLiveQuery` re-runs a query when a Dexie table it
 *    *touched* changes. A pure cache hit touches nothing, so the moment this returned early without
 *    reading anything, the search stopped re-rendering when remote results arrived: the food was
 *    fetched, cached, and never displayed. That looked exactly like the search finding nothing.
 * 2. They're the validity check, so a write that forgets `invalidateFoodIndex` still can't serve a
 *    stale list — a count is an index-only read and costs nothing next to a full scan.
 */
async function allCachedFoods(): Promise<IndexedFood[]> {
  const [referenceCount, customCount] = await Promise.all([
    db.foods.count(),
    db.customFoods.count(),
  ])
  const size = referenceCount + customCount
  if (foodIndex && foodIndex.size === size) return foodIndex.rows

  const [reference, custom] = await Promise.all([
    db.foods.toArray(),
    db.customFoods.filter(alive).toArray(),
  ])
  const claimed = new Set(custom.map((food) => food.barcode).filter(isPresent))
  foodIndex = {
    rows: [...reference.filter((food) => !claimed.has(food.barcode ?? '')), ...custom].map((food) => ({
      food,
      haystack: haystackOf(food),
    })),
    size,
  }
  return foodIndex.rows
}

/**
 * Substring search over everything cached locally, ranked by lib/foodSearch.
 *
 * **Every term first, then whatever matched most of the query.** The all-terms rule on its own was
 * deleting the right answer: USDA returns 24 rows for "spaghetti noodles" and not one of them
 * contains the word "noodles" — they are "Spaghetti, cooked", "Noodles, egg, dry", "Spaghetti sauce"
 * — so the remote search worked, its rows were cached, and then re-filtering them here threw the lot
 * away and the screen said nothing matched. Exactly the defect the ingredient matcher had, in the
 * search box. See `overlapScore` for why the head noun wins the top-up.
 */
/** Below this many all-terms matches the query has effectively failed, and relaxing it beats nothing. */
const ENOUGH_STRICT = 3

export async function searchFoods(query: string, limit = 40): Promise<Food[]> {
  const terms = queryTerms(query)
  if (query.trim().length < 2) return []

  const strict: Food[] = []
  const rest: IndexedFood[] = []
  for (const row of await allCachedFoods()) {
    if (matchesHaystack(row.haystack, terms)) strict.push(row.food)
    else rest.push(row)
  }

  const ranked = rankFoods(strict, query, limit)
  // Only when the strict search has genuinely come up short. A single-term query has nothing to relax,
  // and a query with a real page of exact matches doesn't want rows that matched half of it: "chicken
  // thigh" with a dozen answers should not start listing everything containing "chicken".
  if (terms.length < 2 || ranked.length >= ENOUGH_STRICT) return ranked
  return [...ranked, ...bestOverlap(rest, terms, query, limit - ranked.length)]
}

/**
 * The rows that matched the most of the query, ranked normally among themselves.
 *
 * Only the top overlap tier competes: below it a row is a different food that happens to share a
 * word, and letting those in is how "chicken thigh" starts returning beef.
 */
function bestOverlap(
  rows: readonly IndexedFood[],
  terms: readonly string[],
  query: string,
  limit: number,
): Food[] {
  const scored = rows
    .map((row) => ({ row, overlap: overlapScore(row.haystack, terms) }))
    .filter((entry) => entry.overlap > 0)
  if (scored.length === 0) return []

  const best = Math.max(...scored.map((entry) => entry.overlap))
  return rankFoods(
    scored.filter((entry) => entry.overlap === best).map((entry) => entry.row.food),
    query,
    limit,
  )
}

/**
 * The user's own recipes and saved meals, matched by name.
 *
 * Because they were unfindable. Searching "lasagna soup" — a recipe the user had imported, named and
 * cooked twice — returned USDA's lasagna rows and not their own, and the only way to reach it was to
 * remember it existed and go to a different tab. A thing you saved is the *most* likely answer to
 * typing its name, so these rank above the database rather than beside it.
 *
 * Substring over every term, in any order, over the name only: an ingredient list is not a name, and
 * matching on it would make every recipe containing an onion a hit for "onion".
 */
export async function searchLibrary(query: string, limit = 8): Promise<LibraryHit[]> {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const hits = (r: { name: string }) => terms.every((term) => r.name.toLowerCase().includes(term))
  const [recipeRows, templateRows] = await Promise.all([
    db.recipes.filter((row) => alive(row) && hits(row)).toArray(),
    db.mealTemplates.filter((row) => alive(row) && hits(row)).toArray(),
  ])

  const saved: LibraryHit[] = [
    ...recipeRows.map((recipe) => ({ kind: 'recipe' as const, recipe, name: recipe.name })),
    ...templateRows.map((template) => ({ kind: 'meal' as const, template, name: template.name })),
  ]

  // Dishes from the diary too, because a described meal is not saved anywhere: "3 steak tacos" was
  // eaten, named and re-loggable, and could only be reached by scrolling back to the day it was on.
  // Dropped where a recipe or saved meal already answers by that name — logging a recipe copies its
  // name onto every row, so the two would otherwise be the same answer twice.
  const named = new Set(saved.map((hit) => hit.name.toLowerCase()))
  const fromDiary = (await searchHistory(query, { limit })).flatMap((item): LibraryHit[] => {
    if (item.kind === 'food' || named.has(item.name.toLowerCase())) return []
    return item.kind === 'dish'
      ? [{ kind: 'dish' as const, dish: item, name: item.name }]
      : [{ kind: 'quick' as const, quick: item, name: item.name }]
  })

  return [...saved, ...fromDiary]
    // A name that *starts* with what was typed first, then alphabetically: with a handful of saved
    // things any stable order will do, and "starts with" is the one that feels like a search.
    .sort((a, b) => {
      const rank = (name: string) => (name.toLowerCase().startsWith(terms[0]!) ? 0 : 1)
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
    })
    .slice(0, limit)
}

export type LibraryHit =
  | { kind: 'recipe'; recipe: Recipe; name: string }
  | { kind: 'meal'; template: MealTemplate; name: string }
  | { kind: 'dish'; dish: RecentDish; name: string }
  | { kind: 'quick'; quick: RecentQuick; name: string }

/**
 * Things you have actually eaten, matched by name, going much further back than Recent shows.
 *
 * Recent holds thirty days and forty rows, which is the right size for a list you browse and the wrong
 * one for a question you ask: "carrot cake" was in the diary and unfindable, because the only way to
 * reach a past dish was to scroll to the day it was on. Searching what you've eaten is also the
 * *fastest* search there is — it's local, it's small, and it's far more likely to be the answer than
 * anything USDA has.
 *
 * Dishes are keyed by name here rather than by contents (`recentItems` does it by signature): for a
 * search, two slightly different lasagna soups are one answer, and the newest sitting is the one worth
 * re-logging.
 */
export async function searchHistory(
  query: string,
  { days = 180, limit = 8 }: { days?: number; limit?: number } = {},
): Promise<RecentItem[]> {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const from = dayKeyOffset(Date.now(), days)
  const entries = await entriesBetween(from, dayKey(Date.now()))
  const foods = await foodsByIds(entries.map((entry) => entry.foodId).filter(isPresent))
  const hits = (text: string) => {
    const lower = text.toLowerCase()
    return terms.every((term) => lower.includes(term))
  }

  // One group per dish *name*, holding every sitting of it.
  const byName = new Map<string, Map<string, LogEntry[]>>()
  const byFood = new Map<string, { entry: LogEntry; times: number }>()
  const byQuick = new Map<string, { entry: LogEntry; times: number }>()
  for (const entry of entries) {
    if (entry.dishId !== null && entry.dishName !== null) {
      if (!hits(entry.dishName)) continue
      const key = entry.dishName.toLowerCase()
      const sittings = byName.get(key) ?? new Map<string, LogEntry[]>()
      sittings.set(entry.dishId, [...(sittings.get(entry.dishId) ?? []), entry])
      byName.set(key, sittings)
      continue
    }
    // A food that only ever arrived inside a dish is left out for the same reason it is in
    // `recentItems`: "Cheese, ricotta" is not something anybody logged, it came with the lasagna.
    if (entry.dishId !== null) continue
    if (entry.foodId === null) {
      const key = quickKey(entry)
      if (key === null || !hits(entry.note ?? '')) continue
      const current = byQuick.get(key)
      if (!current) byQuick.set(key, { entry, times: 1 })
      else {
        current.times += 1
        if (entry.eatenAt > current.entry.eatenAt) current.entry = entry
      }
      continue
    }
    const food = foods.get(entry.foodId)
    if (!food || !hits(food.description)) continue
    const current = byFood.get(entry.foodId)
    if (!current) byFood.set(entry.foodId, { entry, times: 1 })
    else {
      current.times += 1
      if (entry.eatenAt > current.entry.eatenAt) current.entry = entry
    }
  }

  const items: RecentItem[] = []
  for (const sittings of byName.values()) {
    const newest = [...sittings.values()].sort(
      (a, b) => Math.max(...b.map((r) => r.eatenAt)) - Math.max(...a.map((r) => r.eatenAt)),
    )[0]!
    const ordered = [...newest].sort((a, b) => a.sortIndex - b.sortIndex)
    items.push({
      kind: 'dish',
      dishId: ordered[0]!.dishId!,
      name: ordered[0]!.dishName ?? 'Dish',
      lastAt: Math.max(...ordered.map((row) => row.eatenAt)),
      times: sittings.size,
      nutrients: sumNutrients(ordered.map((row) => row.nutrients)),
      parts: ordered
        .map((row) => (row.foodId ? foods.get(row.foodId)?.description : null) ?? row.note)
        .filter(Boolean),
    })
  }
  for (const { entry, times } of byFood.values()) {
    const food = foods.get(entry.foodId!)
    if (!food) continue
    items.push({
      kind: 'food',
      food,
      lastAt: entry.eatenAt,
      times,
      amount:
        entry.grams > 0
          ? { grams: entry.grams, portionId: entry.portionId, portionCount: entry.portionCount }
          : null,
    })
  }
  for (const { entry, times } of byQuick.values()) {
    const quick = asQuick(entry, times)
    if (quick) items.push(quick)
  }

  return items.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit)
}

// --- The user's own foods ----------------------------------------------------------

export interface CustomFoodInput {
  description: string
  brand?: string | null
  barcode?: string | null
  per100: Nutrients
  /** A serving size in grams, if the label states one. */
  servingGrams?: number | null
  servingLabel?: string | null
}

export function customFoods(): Promise<CustomFood[]> {
  return db.customFoods.filter(alive).toArray()
}

/**
 * Creates or updates one of the user's own foods.
 *
 * Ids are `custom:<uuid>` so they can never collide with a `usda:`/`off:` row, and existing log
 * entries keep pointing at the same food when it's edited — the entries themselves keep the
 * nutrients they were logged with, so correcting a food never rewrites history.
 */
export async function saveCustomFood(
  input: CustomFoodInput,
  id = `custom:${newId()}`,
): Promise<string> {
  const existing = await db.customFoods.get(id)
  const portions: FoodPortion[] =
    input.servingGrams && input.servingGrams > 0
      ? [
          {
            id: 'custom-serving',
            label: input.servingLabel?.trim() || '1 serving',
            grams: input.servingGrams,
            isDefault: true,
          },
        ]
      : []

  const row: CustomFood = {
    id,
    userId: activeUserId,
    source: 'custom',
    description: input.description.trim(),
    brand: input.brand?.trim() || null,
    barcode: input.barcode?.trim() || null,
    category: null,
    dataType: 'custom',
    per100: input.per100,
    gramsPerMl: null,
    portions,
    verifiedAt: null,
    ...syncStamp(),
    ...(existing ? { ...touch(existing.clientRev), createdAt: existing.createdAt } : {}),
  }

  await db.customFoods.put(row)
  await enqueue('customFoods', row.id)
  invalidateFoodIndex()
  return row.id
}

export async function keepAsOwnFood(food: Food): Promise<Food> {
  if (food.source === 'custom') return food
  const barcode = food.barcode?.trim() || null
  if (barcode === null) return food

  const existing = await db.customFoods.where('barcode').equals(barcode).filter(alive).first()
  if (existing) return existing

  const portion = portionFor(food, null)
  const id = await saveCustomFood({
    description: food.description,
    brand: food.brand,
    barcode,
    servingGrams: portion?.grams ?? null,
    servingLabel: portion?.label ?? null,
    per100: food.per100,
  })
  return (await db.customFoods.get(id)) ?? food
}

export async function deleteCustomFood(id: string): Promise<void> {
  await patch('customFoods', id, { deletedAt: Date.now() })
  invalidateFoodIndex()
}

export async function putFoods(foods: readonly Food[]): Promise<void> {
  await db.foods.bulkPut(foods as Food[])
  invalidateFoodIndex()
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

const noonOf = (day: string): number => Date.parse(`${day}T12:00:00`)

export async function loggedDays(): Promise<string[]> {
  const days = new Set<string>()
  await db.logEntries.filter(alive).each((entry) => days.add(entry.day))
  return [...days].sort()
}

/** What "your data comes with you" actually refers to. */
export const countLoggedDays = async (): Promise<number> => (await loggedDays()).length

/**
 * Distinct foods logged most often *on their own*, for the Log screen's frequents.
 *
 * Windowed rather than lifetime: this runs every time the Add food screen opens, and a food last
 * eaten eight months ago is not what "frequent" means to anyone. The `day` index makes it a range
 * scan instead of a walk over the whole history.
 *
 * Rows belonging to a dish are skipped. Counting them filled the list with things nobody logs by
 * itself — after three taco dinners, "Often" offered coriander, onion and sour cream, because each
 * had been written three times. The dish is already one row in `recentItems` with its own count; its
 * parts are an implementation detail of that row, not foods the user reaches for.
 */
export async function frequentFoodIds(limit = 20, days = 90): Promise<string[]> {
  const counts = new Map<string, number>()
  const from = dayKeyOffset(Date.now(), days)
  await db.logEntries
    .where('day')
    .aboveOrEqual(from)
    .filter(alive)
    .each((entry) => {
      if (entry.foodId && entry.dishId === null) {
        counts.set(entry.foodId, (counts.get(entry.foodId) ?? 0) + 1)
      }
    })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

/**
 * The cuisines of the last few recipe servings, newest first — the variety signal.
 *
 * Only entries that came from a recipe: a food row has no cuisine, and inferring one from
 * "chicken breast, raw" would be guessing about the very thing the recommendation is trying to
 * avoid getting wrong. Someone who cooks nothing gets an empty list, and variety then weighs
 * nothing rather than weighing noise.
 */
export async function recentRecipeCuisines(limit = 10): Promise<(CuisineKey | null)[]> {
  const entries = await db.logEntries
    .orderBy('eatenAt')
    .reverse()
    .filter((entry) => alive(entry) && recipeOf(entry) !== null)
    .limit(limit)
    .toArray()
  const byId = new Map((await db.recipes.bulkGet(entries.map((e) => recipeOf(e)!))).flatMap((row) =>
    row ? [[row.id, row] as const] : [],
  ))
  return entries.map((entry) => byId.get(recipeOf(entry)!)?.cuisine ?? null)
}

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

/**
 * Oldest first. A total order, which is the point.
 *
 * Ids are random UUIDs and a multi-select writes several rows inside one millisecond, so `eatenAt`
 * alone leaves "last time" up to whatever order IndexedDB returned — and `lastAmountFor` is the thing
 * that makes logging fast, so it has to give the same answer twice. When two rows tie on time they are
 * equally recent; all that matters is that the tie is broken the same way every run.
 */
const byRecency = (a: LogEntry, b: LogEntry): number =>
  a.eatenAt - b.eatenAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id)

const isLater = (a: LogEntry, b: LogEntry): boolean => byRecency(a, b) > 0

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

// --- Water ------------------------------------------------------------------------

/**
 * A day's water, by a deterministic id.
 *
 * `w:${userId}:${day}` rather than a random id, for the same reason weigh-ins use one: tapping
 * "+ a glass" eight times is eight edits to one running total, not eight events, and two devices
 * that each recorded some of a day's water must converge on one row rather than accumulate two.
 */
const waterId = (day: string): string => `w:${activeUserId}:${day}`

export function waterForDay(day: string): Promise<WaterRow | undefined> {
  return db.waterLogs.get(waterId(day))
}

export function waterBetween(fromDay: string, toDay: string): Promise<WaterRow[]> {
  return db.waterLogs.where('day').between(fromDay, toDay, true, true).filter(alive).toArray()
}

/** Adds (or, with a negative delta, removes) water. Never goes below zero. */
export async function addWater(day: string, deltaMl: number): Promise<number> {
  const id = waterId(day)
  const existing = await db.waterLogs.get(id)
  const ml = Math.max(0, Math.round((existing?.ml ?? 0) + deltaMl))

  if (existing) {
    await patch('waterLogs', id, { ml, deletedAt: null })
    return ml
  }
  const row: WaterRow = { id, userId: activeUserId, day, ml, ...syncStamp() }
  await db.waterLogs.put(row)
  await enqueue('waterLogs', id)
  return ml
}

export function setWaterTarget(ml: number | null): Promise<void> {
  return saveProfile({ waterTargetMl: ml })
}

export function setReminders(reminders: RemindersConfig | null): Promise<void> {
  return saveProfile({ reminders })
}

/**
 * Sets or clears targets by hand.
 *
 * Stamped with today, so it governs from now on and leaves what's already been scored alone — see
 * `ManualTargets`. Null goes back to the measured target, which is still being computed underneath
 * the whole time.
 */
export function setManualTargets(targets: MacroTargets | null): Promise<void> {
  return saveProfile({
    manualTargets: targets === null ? null : { ...targets, fromDay: dayKey(Date.now()) },
  })
}

// --- Recipes ----------------------------------------------------------------------

export function recipes(): Promise<Recipe[]> {
  return db.recipes.filter(alive).toArray()
}

export function getRecipe(id: string): Promise<Recipe | undefined> {
  return db.recipes.get(id)
}

export interface RecipeInput {
  name: string
  servings: number
  ingredients: {
    foodId: string | null
    label: string
    grams: number
    optional?: boolean
    /** What the recipe said — "1 cup", "2 tbsp". See `RecipeIngredient.amount`. */
    amount?: string | null
  }[]
  steps?: string[]
  yieldGrams?: number | null
  cuisine?: CuisineKey | null
  totalMinutes?: number | null
  /** Whatever the source called it, when that didn't map onto a cuisine. */
  tags?: string[]
  /** Where it was imported from, kept so the original is one tap away. */
  sourceUrl?: string | null
}

/**
 * Creates or updates a recipe, with its total computed from the ingredients here.
 *
 * The total is stored rather than derived on read for the same reason a log entry stores its
 * nutrients: a reference-data correction must not silently change what last week's dinner
 * contained. Editing the recipe recomputes it; logging a serving copies it.
 */
export async function saveRecipe(input: RecipeInput, id = newId()): Promise<string> {
  const ingredients: RecipeIngredient[] = input.ingredients.map((ingredient) => ({
    id: newId(),
    foodId: ingredient.foodId,
    label: ingredient.label.trim(),
    grams: ingredient.grams,
    optional: ingredient.optional ?? false,
    amount: ingredient.amount ?? null,
  }))
  const foods = await foodsByIds(ingredients.map((i) => i.foodId).filter(isPresent))
  const existing = await db.recipes.get(id)

  const recipe: Recipe = {
    id,
    userId: activeUserId,
    name: input.name.trim() || 'Recipe',
    servings: Math.max(1, Math.round(input.servings)),
    yieldGrams: input.yieldGrams ?? null,
    ingredients,
    steps: input.steps ?? [],
    tags: input.tags ?? [],
    cuisine: input.cuisine ?? null,
    totalMinutes: input.totalMinutes ?? null,
    sourceUrl: input.sourceUrl ?? null,
    authoredBy: 'user',
    nutrients: recipeNutrients({ ingredients }, foods),
    ...syncStamp(),
    ...(existing ? { ...touch(existing.clientRev), createdAt: existing.createdAt } : {}),
  }

  await db.recipes.put(recipe)
  await enqueue('recipes', recipe.id)
  return recipe.id
}

export function deleteRecipe(id: string): Promise<void> {
  return patch('recipes', id, { deletedAt: Date.now() })
}

/**
 * How often each recipe actually gets cooked, from the log rather than a counter.
 *
 * Derived, not stored: a stored `timesCooked` would drift the moment an entry is deleted or
 * retimed, and "how many times have I eaten this" is exactly a question the log already answers.
 * One pass over the window, keyed by recipe, so ranking every recipe costs one scan and not one
 * query each.
 */
export async function recipeUsage(days = 365): Promise<Map<string, RecipeUsage>> {
  /**
   * Servings, not rows.
   *
   * A recipe is logged as one row per ingredient, so counting rows said a fourteen-ingredient
   * lasagna soup had been cooked **fourteen times** the first evening it was made — and that number
   * drives "you cook this a lot", which then recommended it on the strength of its own ingredient
   * list. Rows written together share a `dishId`, so a sitting is a dishId; a row without one is its
   * own sitting, which is the older single-row shape.
   */
  const sittings = new Map<string, Set<string>>()
  const lastDay = new Map<string, string>()
  const from = dayKeyOffset(Date.now(), days)

  await db.logEntries
    .where('day')
    .aboveOrEqual(from)
    .filter(alive)
    .each((entry) => {
      const recipeId = entry.recipeId ?? entry.fromRecipeId
      if (!recipeId) return
      const seen = sittings.get(recipeId) ?? new Set<string>()
      seen.add(entry.dishId ?? entry.id)
      sittings.set(recipeId, seen)
      const known = lastDay.get(recipeId)
      if (known === undefined || entry.day > known) lastDay.set(recipeId, entry.day)
    })

  return new Map(
    [...sittings].map(([recipeId, seen]) => [
      recipeId,
      { timesCooked: seen.size, lastCookedDay: lastDay.get(recipeId) ?? null },
    ]),
  )
}

/**
 * Logs `servings` of a recipe as one entry per ingredient.
 *
 * The default, because a single row carrying the recipe's total is a dead end: it has no food behind
 * it, so it contributes no micronutrients, can't be searched, can't be re-portioned, and can't tell
 * you that the ricotta was a third of the calories. Ingredients scale by
 * `servings / recipe.servings` and each row resolves its own nutrients from its own food, exactly
 * like any other logged food.
 *
 * Ingredients that matched nothing are skipped — as they already are in the recipe's stored total
 * (see `recipeNutrients`), so the two agree rather than one silently exceeding the other.
 */
export async function logRecipeIngredients(
  recipe: Recipe,
  servings: number,
  meal: MealSlot,
  at = Date.now(),
  venue: Venue | null = 'home',
): Promise<number> {
  const share = servings / Math.max(1, recipe.servings)
  const foods = await foodsByIds(recipe.ingredients.map((row) => row.foodId).filter(isPresent))
  const dishId = newId()

  let written = 0
  for (const ingredient of recipe.ingredients) {
    const food = ingredient.foodId === null ? undefined : foods.get(ingredient.foodId)
    const grams = ingredient.grams * share
    if (!food || grams <= 0) continue
    await logFood({
      food,
      grams,
      meal,
      eatenAt: at,
      venue,
      source: 'recipe',
      note: recipe.name,
      // Its id, so "what you cook" and `recipeUsage` still see the dish...
      fromRecipeId: recipe.id,
      // ...and one dish id across the set, so the day shows one line the user recognises rather
      // than nine unrelated foods that happen to share a timestamp.
      dishId,
      dishName: recipe.name,
    })
    written += 1
  }
  return written
}

const isPresent = (value: string | null): value is string => value !== null

/** The recipe a row belongs to, whether it *is* the recipe or came out of one. */
export const recipeOf = (entry: LogEntry): string | null => entry.recipeId ?? entry.fromRecipeId

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
  return saveMealFromParts(
    name,
    entries.map((entry) => ({
      foodId: entry.foodId,
      recipeId: entry.recipeId,
      grams: entry.grams,
      nutrients: entry.nutrients,
    })),
  )
}

export interface MealPart {
  foodId: string | null
  recipeId?: string | null
  grams: number
  nutrients: Nutrients
}

/**
 * Saves a set of foods as a meal, optionally divided down to one of something.
 *
 * `perUnit` is why this exists. "3 steak tacos" resolves to six foods at the amounts for three tacos,
 * and saving *that* means having one tomorrow needs either mental arithmetic or a second near-identical
 * saved meal. Divided by the count, one taco is what's stored — and 1, 3 or 5 of them are all a
 * multiple away, which `logMealTemplate` already takes.
 */
export async function saveMealFromParts(
  name: string,
  parts: readonly MealPart[],
  perUnit = 1,
): Promise<string> {
  const share = 1 / Math.max(1, perUnit)
  const items: MealTemplateItem[] = parts.map((part) => ({
    id: newId(),
    foodId: part.foodId,
    recipeId: part.recipeId ?? null,
    grams: part.grams * share,
    nutrients: scaleNutrients(part.nutrients, share),
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

/** Removes a whole dish — every row it was logged as, in one action. */
export async function deleteDish(dishId: string): Promise<number> {
  const rows = await db.logEntries.where('dishId').equals(dishId).filter(alive).toArray()
  for (const row of rows) await patch('logEntries', row.id, { deletedAt: Date.now() })
  return rows.length
}

/** A saved meal's default name is a date, so renaming it is what makes the list usable. */
export function renameMealTemplate(id: string, name: string): Promise<void> {
  return patch('mealTemplates', id, { name: name.trim() || 'Saved meal' })
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
  // Home by default, like every other write path — see `LogScreen` on why the default beats null.
  venue: Venue | null = 'home',
): Promise<number> {
  const dishId = newId()
  for (const item of template.items) {
    const entry: LogEntry = {
      id: newId(),
      userId: activeUserId,
      day: dayKey(at),
      eatenAt: at,
      meal,
      sortIndex: nextSortIndex(at),
      foodId: item.foodId,
      recipeId: item.recipeId,
      fromRecipeId: null,
      dishId,
      dishName: template.name,
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
      venue,
      note: template.name,
      ...syncStamp(),
    }
    await db.logEntries.put(entry)
    await enqueue('logEntries', entry.id)
  }
  return template.items.length
}

/**
 * What you have actually been eating, newest first — the list that should open when you tap "Log".
 *
 * This replaces a list keyed on `day|meal`, which was the app's worst piece of modelling. A
 * filing coordinate is not an identity, so eating the same lunch every weekday produced *eight
 * separate rows* — each labelled "Lunch · Tuesday", none naming a single food — and the list grew
 * forever instead of converging on the six things a real person eats.
 *
 * Keyed on **contents** instead: a dish's signature is its foods and their rounded amounts, so those
 * eight lunches become one row that says "8×". Single foods get a row each. A food that has only ever
 * been eaten as part of a dish is left out, because "Cheese, Ricotta" is not something anyone logs on
 * its own — it arrived inside the lasagna, and the lasagna is already in the list.
 */
export interface RecentFood {
  kind: 'food'
  food: Food
  lastAt: number
  times: number
  amount: LastAmount | null
}

export interface RecentDish {
  kind: 'dish'
  /** The most recent sitting's id — what "log this again" re-logs. */
  dishId: string
  name: string
  lastAt: number
  times: number
  nutrients: Nutrients
  /** Food names in order, for a subtitle a person can recognise the dish by. */
  parts: string[]
}

export interface RecentQuick {
  kind: 'quick'
  name: string
  lastAt: number
  times: number
  nutrients: Nutrients
}

export type RecentItem = RecentFood | RecentDish | RecentQuick

const quickKey = (entry: LogEntry): string | null =>
  entry.quickAdd !== null && (entry.note ?? '').trim() !== ''
    ? `quick:${entry.note!.trim().toLowerCase()}`
    : null

function asQuick(entry: LogEntry, times: number): RecentQuick | null {
  if (quickKey(entry) === null) return null
  return {
    kind: 'quick',
    name: entry.note!.trim(),
    lastAt: entry.eatenAt,
    times,
    nutrients: entry.nutrients,
  }
}

export async function recentItems(days = 30, limit = 40): Promise<RecentItem[]> {
  const from = dayKeyOffset(Date.now(), days)
  /**
   * Oldest first, so "the latest one wins" is decided by position.
   *
   * See `byRecency` for why the tie-break matters.
   */
  const entries = (await entriesBetween(from, dayKey(Date.now()))).sort(byRecency)

  const dishRows = new Map<string, LogEntry[]>()
  const loose: LogEntry[] = []
  for (const entry of entries) {
    if (entry.dishId === null) loose.push(entry)
    else dishRows.set(entry.dishId, [...(dishRows.get(entry.dishId) ?? []), entry])
  }

  const foods = await foodsByIds([
    ...entries.map((entry) => entry.foodId).filter(isPresent),
  ])
  const nameOf = (entry: LogEntry): string =>
    (entry.foodId ? foods.get(entry.foodId)?.description : null) ?? entry.note ?? ''

  // Sittings collapsed by what they contained, so the same dinner counts rather than repeats.
  const bySignature = new Map<string, { rows: LogEntry[][]; lastAt: number; latest: string }>()
  for (const [dishId, rows] of dishRows) {
    const ordered = [...rows].sort((a, b) => a.sortIndex - b.sortIndex)
    const signature = [
      ordered[0]?.dishName ?? '',
      ...ordered.map((row) => `${row.foodId ?? row.recipeId ?? 'q'}:${Math.round(row.grams)}`).sort(),
    ].join('|')
    const lastAt = Math.max(...ordered.map((row) => row.eatenAt))
    const current = bySignature.get(signature)
    if (!current) bySignature.set(signature, { rows: [ordered], lastAt, latest: dishId })
    else {
      current.rows.push(ordered)
      if (lastAt > current.lastAt) {
        current.lastAt = lastAt
        current.latest = dishId
      }
    }
  }

  const dishes: RecentDish[] = [...bySignature.values()].map((group) => {
    const newest = group.rows.find((rows) => rows.some((row) => row.eatenAt === group.lastAt)) ?? group.rows[0]!
    return {
      kind: 'dish',
      dishId: group.latest,
      name: newest[0]?.dishName ?? 'Dish',
      lastAt: group.lastAt,
      times: group.rows.length,
      nutrients: sumNutrients(newest.map((row) => row.nutrients)),
      parts: newest.map(nameOf).filter(Boolean),
    }
  })

  const byFood = new Map<string, { entry: LogEntry; times: number }>()
  for (const entry of loose) {
    const key = entry.foodId ?? quickKey(entry)
    if (key === null) continue
    const current = byFood.get(key)
    if (!current) byFood.set(key, { entry, times: 1 })
    else {
      current.times += 1
      current.entry = entry
    }
  }

  const items: RecentItem[] = [...dishes]
  for (const { entry, times } of byFood.values()) {
    const food = entry.foodId ? foods.get(entry.foodId) : undefined
    if (!food) {
      const quick = asQuick(entry, times)
      if (quick) items.push(quick)
      continue
    }
    items.push({
      kind: 'food',
      food,
      lastAt: entry.eatenAt,
      times,
      amount: entry.grams > 0
        ? { grams: entry.grams, portionId: entry.portionId, portionCount: entry.portionCount }
        : null,
    })
  }

  return items.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit)
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

export async function recordWeight(
  kg: number,
  day = dayKey(Date.now()),
  source = 'macros',
): Promise<void> {
  const id = weightIdFor(activeUserId, day)
  const existing = (await db.bodyWeights.get(id)) ?? (await byDay(day))

  if (existing) {
    if (existing.id === id) {
      await patch('bodyWeights', id, { kg, source, deletedAt: null })
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
    source,
    ...syncStamp(),
  }
  await db.bodyWeights.put(row)
  await enqueue('bodyWeights', row.id)
}

/** Weigh-ins that came from Health rather than from this app. */
const HEALTH_SOURCE = 'apple-health'

export interface WeightImport {
  day: string
  kg: number
  at: number
}

/**
 * Brings weigh-ins in from Health.
 *
 * Two rules, both about not overwriting the user:
 *
 * 1. A day already weighed in *in this app* is left alone. Someone who typed 80.4 here meant it,
 *    and a smart scale's later reading that evening shouldn't silently replace it.
 * 2. Where a day has several samples, the earliest is used. Weight drifts up over a day by a kilo
 *    or more, so mixing morning and evening readings would add noise the trend then has to smooth
 *    back out — a consistent time of day matters more than which time.
 */
export async function importWeights(samples: readonly WeightImport[]): Promise<number> {
  const earliestPerDay = new Map<string, WeightImport>()
  for (const sample of samples) {
    const current = earliestPerDay.get(sample.day)
    if (!current || sample.at < current.at) earliestPerDay.set(sample.day, sample)
  }

  let imported = 0
  for (const sample of earliestPerDay.values()) {
    const existing = await db.bodyWeights.get(weightIdFor(activeUserId, sample.day))
    if (existing && existing.deletedAt === null && existing.source !== HEALTH_SOURCE) continue
    if (existing?.kg === sample.kg && existing.source === HEALTH_SOURCE) continue

    await recordWeight(Math.round(sample.kg * 10) / 10, sample.day, HEALTH_SOURCE)
    imported += 1
  }
  return imported
}

const byDay = (day: string) => db.bodyWeights.where('day').equals(day).filter(alive).first()

// --- Program & check-ins ----------------------------------------------------------

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
          ? initialTargetsFromTrend(program, profile, trendKg, Date.parse(`${day}T12:00:00`))
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

export interface CheckInStatus {
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
  const to = dayKey(Date.parse(`${week}T12:00:00`) + 6 * DAY_MS)
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
    ['customFoods', db.customFoods],
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

  claimed += await claimWater(userId)
  return claimed
}

/**
 * Water has to be re-keyed, not just re-owned.
 *
 * Its id embeds the owner — `w:${userId}:${day}` — because that determinism is what stops eight taps
 * of "+ a glass" becoming eight rows. Updating `userId` in place would leave the old owner in the id,
 * so the next `addWater` on the same day would compute a *different* id, insert a second row, and hit
 * the server's unique (user_id, day) index. Delete and re-insert, exactly as the profile does.
 */
async function claimWater(userId: string): Promise<number> {
  const stale = await db.waterLogs.where('userId').notEqual(userId).toArray()
  let claimed = 0
  for (const row of stale) {
    const id = `w:${userId}:${row.day}`
    const existing = await db.waterLogs.get(id)
    // A row already under the new owner wins: it belongs to the account, and this one is a local
    // draft for the same day.
    if (!existing) {
      await db.waterLogs.put({ ...row, id, userId, ...touch(row.clientRev) })
      await enqueue('waterLogs', id)
      claimed += 1
    }
    await db.waterLogs.delete(row.id)
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
    db.customFoods.clear(),
    db.logEntries.clear(),
    db.bodyWeights.clear(),
    db.waterLogs.clear(),
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
