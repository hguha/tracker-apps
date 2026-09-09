import { DAY_MS, dayKey, dayKeyOffset } from '@tracker-engine/core'
import { syncStamp, touch } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import { weightTrend, type TrendPoint } from '@tracker-engine/body'
import { db, owner } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import {
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
  type Venue,
} from '@/domain/types'
import {
  cycleDayTargets,
  nutrientsFor,
  perServing,
  portionFor,
  recipeNutrients,
  scale as scaleNutrients,
  sum as sumNutrients,
} from '@/lib/nutrition'
import { multiplierForDay } from '@/lib/cycling'
import { matchesQuery, queryTerms, rankFoods } from '@/lib/foodSearch'
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
    favouriteFoodIds: [],
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
  // A field added after launch is absent on older rows, and `.map` on undefined throws.
  return { ...row, favouriteFoodIds: row.favouriteFoodIds ?? [] }
}

/**
 * Pins or unpins a food.
 *
 * Newest first, so the list reads as "what I've been eating lately" rather than as an archive, and
 * capped — a favourites list of ninety is the frequents list with extra steps.
 */
export async function toggleFavourite(foodId: string): Promise<void> {
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
let foodIndex: { rows: Food[]; size: number } | null = null

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
async function allCachedFoods(): Promise<Food[]> {
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
  foodIndex = { rows: [...reference, ...custom], size }
  return foodIndex.rows
}

/** Substring search over everything cached locally, ranked by lib/foodSearch. */
export async function searchFoods(query: string, limit = 40): Promise<Food[]> {
  const terms = queryTerms(query)
  if (query.trim().length < 2) return []

  const matches = (await allCachedFoods()).filter((food) => matchesQuery(food, terms))
  return rankFoods(matches, query, limit)
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
export async function loggedDays(): Promise<string[]> {
  const days = new Set<string>()
  await db.logEntries.filter(alive).each((entry) => days.add(entry.day))
  return [...days].sort()
}

/** What "your data comes with you" actually refers to. */
export const countLoggedDays = async (): Promise<number> => (await loggedDays()).length

/**
 * Distinct foods logged most often, for the Log screen's frequents.
 *
 * Windowed rather than lifetime: this runs every time the Add food screen opens, and a food last
 * eaten eight months ago is not what "frequent" means to anyone. The `day` index makes it a range
 * scan instead of a walk over the whole history.
 */
export async function frequentFoodIds(limit = 20, days = 90): Promise<string[]> {
  const counts = new Map<string, number>()
  const from = dayKeyOffset(Date.now(), days)
  await db.logEntries
    .where('day')
    .aboveOrEqual(from)
    .filter(alive)
    .each((entry) => {
      if (entry.foodId) counts.set(entry.foodId, (counts.get(entry.foodId) ?? 0) + 1)
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

export async function lastAmountFor(foodId: string): Promise<LastAmount | null> {
  const rows = await db.logEntries.where('foodId').equals(foodId).filter(alive).toArray()
  const latest = rows.sort((a, b) => b.eatenAt - a.eatenAt)[0]
  if (!latest || latest.grams <= 0) return null
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
  const wanted = new Set(foodIds)
  const best = new Map<string, LogEntry>()
  await db.logEntries.filter(alive).each((entry) => {
    if (!entry.foodId || !wanted.has(entry.foodId) || entry.grams <= 0) return
    const current = best.get(entry.foodId)
    if (!current || entry.eatenAt > current.eatenAt) best.set(entry.foodId, entry)
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
    fromRecipeId: input.fromRecipeId ?? null,
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
  label = 'Quick add',
  eatenAt = Date.now(),
  venue: Venue | null = null,
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
    fromRecipeId: null,
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
      grams: entry.grams * multiple,
      nutrients: scaleNutrients(entry.nutrients, multiple),
      quickAdd: entry.quickAdd === null ? null : scaleNutrients(entry.quickAdd, multiple),
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
  ingredients: { foodId: string | null; label: string; grams: number; optional?: boolean }[]
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
  const usage = new Map<string, RecipeUsage>()
  const from = dayKeyOffset(Date.now(), days)
  await db.logEntries
    .where('day')
    .aboveOrEqual(from)
    .filter(alive)
    .each((entry) => {
      // Either shape counts as having cooked it: one row for the dish, or one row per ingredient.
      const recipeId = entry.recipeId ?? entry.fromRecipeId
      if (!recipeId) return
      const current = usage.get(recipeId) ?? { timesCooked: 0, lastCookedDay: null }
      usage.set(recipeId, {
        timesCooked: current.timesCooked + 1,
        lastCookedDay:
          current.lastCookedDay === null || entry.day > current.lastCookedDay
            ? entry.day
            : current.lastCookedDay,
      })
    })
  return usage
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
      // The recipe's name on every row, so the day still reads as one dish rather than as nine
      // unrelated foods that happen to share a timestamp.
      note: recipe.name,
      // And its id, so "what you cook" and `recipeUsage` still see the dish.
      fromRecipeId: recipe.id,
    })
    written += 1
  }
  return written
}

/** Logs `servings` of a recipe as one entry, so the day reads "Chilli · 1.5 servings". */
export async function logRecipeServing(
  recipe: Recipe,
  servings: number,
  meal: MealSlot,
  at = Date.now(),
  // A recipe is something you cooked, so home is the default here rather than a guess — the one
  // place in the app where the venue is genuinely implied by the action.
  venue: Venue | null = 'home',
): Promise<string> {
  const nutrients = scaleNutrients(perServing(recipe), servings)
  const entry: LogEntry = {
    id: newId(),
    userId: activeUserId,
    day: dayKey(at),
    eatenAt: at,
    meal,
    sortIndex: at,
    foodId: null,
    recipeId: recipe.id,
    quickAdd: null,
    fromRecipeId: null,
    grams: recipe.yieldGrams ? (recipe.yieldGrams / Math.max(1, recipe.servings)) * servings : 0,
    portionId: null,
    portionCount: servings,
    nutrients,
    source: 'recipe',
    estimate: null,
    venue,
    note: `${recipe.name}${servings === 1 ? '' : ` × ${servings}`}`,
    ...syncStamp(),
  }
  await db.logEntries.put(entry)
  await enqueue('logEntries', entry.id)
  return entry.id
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
  venue: Venue | null = null,
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
      fromRecipeId: null,
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
    intake: await intakeByDay(dayKey(now - 56 * DAY_MS), dayKey(now)),
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
