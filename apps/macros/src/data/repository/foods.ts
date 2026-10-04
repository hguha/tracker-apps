import { syncStamp, touch } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import { type CustomFood, type Food, type FoodPortion, type Nutrients } from '@/domain/types'
import { portionFor } from '@/lib/nutrition'
import { haystackOf, matchesHaystack, overlapScore, queryTerms, rankFoods } from '@/lib/foodSearch'
import { closestGeneric, lendersFrom, type Lender, type LentPortions } from '@/lib/borrowPortions'
import { activeUserId, alive, isPresent } from './internal'

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

function invalidateFoodIndex(): void {
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

export type BorrowedPortions = LentPortions

let lenders: { from: IndexedFood[]; list: Lender[] } | null = null

export async function borrowedPortions(food: Food): Promise<BorrowedPortions | null> {
  const rows = await allCachedFoods()
  if (lenders?.from !== rows) lenders = { from: rows, list: lendersFrom(rows) }
  return closestGeneric(food, lenders.list)
}
