import { dayKeyOffset, groupBy } from '@tracker-engine/core'
import { syncStamp, touch } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue, newId, patch } from '@/data/outbox'
import {
  type CuisineKey,
  type EntrySource,
  type LogEntry,
  type MealSlot,
  type Recipe,
  type RecipeIngredient,
  type RecipeUsage,
  type Venue,
} from '@/domain/types'
import { recipeNutrients } from '@/lib/nutrition'
import { logFood } from './entries'
import { foodsByIds } from './foods'
import { activeUserId, alive, isPresent } from './internal'

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

export function recipes(): Promise<Recipe[]> {
  return db.recipes.filter(alive).toArray()
}

export function getRecipe(id: string): Promise<Recipe | undefined> {
  return db.recipes.get(id)
}

interface RecipeInput {
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
  { dishId = newId(), source = 'recipe' }: { dishId?: string; source?: EntrySource } = {},
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
      source,
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

/** The recipe a row belongs to, whether it *is* the recipe or came out of one. */
const recipeOf = (entry: LogEntry): string | null => entry.recipeId ?? entry.fromRecipeId

export async function recipeSittings(recipeId: string): Promise<LogEntry[][]> {
  const rows = await db.logEntries
    .filter((entry) => alive(entry) && entry.fromRecipeId === recipeId)
    .toArray()
  return [...groupBy(rows, (row) => row.dishId ?? row.id).values()]
}

export async function relogRecipe(before: Recipe, after: Recipe): Promise<number> {
  const counted = before.ingredients
    .filter((row) => row.foodId !== null && row.grams > 0)
    .reduce((total, row) => total + row.grams, 0)
  const sittings = await recipeSittings(before.id)
  for (const rows of sittings) {
    const first = [...rows].sort((a, b) => a.sortIndex - b.sortIndex)[0]!
    const eaten = rows.reduce((total, row) => total + row.grams, 0)
    const servings = counted > 0 ? (eaten / counted) * before.servings : 1
    for (const row of rows) await patch('logEntries', row.id, { deletedAt: Date.now() })
    await logRecipeIngredients(after, servings, first.meal, first.eatenAt, first.venue, {
      dishId: first.dishId ?? newId(),
      source: first.source,
    })
  }
  return sittings.length
}

export async function ownFoodNames(limit = 60): Promise<string[]> {
  const [recipes, foods] = await Promise.all([
    db.recipes.filter(alive).toArray(),
    db.customFoods.filter(alive).toArray(),
  ])
  const named = [
    ...recipes.map((row) => ({ name: row.name, at: row.updatedAt })),
    ...foods.map((row) => ({ name: row.description, at: row.updatedAt })),
  ]
  return [...new Set(named.sort((a, b) => b.at - a.at).map((row) => row.name.trim()))]
    .filter(Boolean)
    .slice(0, limit)
}
