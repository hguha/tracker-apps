import * as repo from '@/data/repository'
import { nutrientsFor, perServing, scale } from '@/lib/nutrition'
import { amountGrams, describeAmount, portionWithGrams } from '@/features/shared/format'
import { EMPTY_NUTRIENTS, type Food, type MealTemplate, type Nutrients, type Recipe } from '@/domain/types'
import type { LibraryHit, RecentDish, RecentItem, RecentQuick } from '@/data/repository'
import type { LogTarget } from '@/features/shared/target'

/**
 * Everything that can be added to a day, behind one shape.
 *
 * There used to be three screens for this. A tangerine got a portion picker with the day it would
 * make; a saved meal got a bottom sheet with 0.5×/1×/1.5×/2× buttons and no sense of the day; a
 * repeated dish got a bare "Log" button that wrote six rows with no confirmation at all. Same
 * question every time — *how much of this, and does it fit?* — asked three different ways, so
 * learning the app meant learning three.
 *
 * They differ in exactly two respects: what the unit is called, and how the write happens. So that's
 * what this describes, and one screen renders all five.
 */
export type Loggable =
  | { kind: 'food'; food: Food }
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'meal'; template: MealTemplate }
  | { kind: 'dish'; dish: RecentDish }
  | { kind: 'quick'; quick: RecentQuick }

/**
 * One way of counting a subject: servings, slices, copies, grams.
 *
 * `nutrientsAt` rather than a per-unit figure multiplied later, because a food's macros are computed
 * from grams and rounded there — so scaling a rounded single unit drifts from what the log will
 * actually record. This asks the same function the write will ask.
 */
export interface AddUnit {
  id: string
  label: string
  nutrientsAt: (count: number) => Nutrients
  /** The weight of `count` of these, when there is one. Null for a recipe serving. */
  gramsAt: (count: number) => number | null
  /**
   * What `count` of these *is*, in a few words.
   *
   * A recipe made the amount box ambiguous: the screen said "7 servings" and the box said "1", so it
   * was impossible to tell whether one or seven were about to be logged. Grams answer this for a
   * food; nothing but words answer it for a serving of a batch.
   */
  summaryAt: (count: number) => string
  /** How much the ± buttons move. Half a serving is meaningful; half a taco is not. */
  step: number
  /** The smallest amount this unit can be logged at. */
  min: number
}

export interface AddSubject {
  title: string
  subtitle: string
  units: AddUnit[]
  /** Which unit to open on — the food's default portion, or the only unit there is. */
  initialUnitId: string
  /** True when the write produces several rows, so the parts are worth showing. */
  isComposite: boolean
  log: (unit: AddUnit, count: number, target: LogTarget) => Promise<number>
}

/** The literal-grams option, alongside a food's own portions. */
export const GRAMS = '__grams'

export function describeLoggable(loggable: Loggable): AddSubject {
  switch (loggable.kind) {
    case 'food':
      return foodSubject(loggable.food)
    case 'recipe':
      return recipeSubject(loggable.recipe)
    case 'meal':
      return mealSubject(loggable.template)
    case 'dish':
      return dishSubject(loggable.dish)
    case 'quick':
      return quickSubject(loggable.quick)
  }
}

function foodSubject(food: Food): AddSubject {
  const units: AddUnit[] = [
    ...food.portions.map((portion) => ({
      id: portion.id,
      label: portionWithGrams(portion),
      nutrientsAt: (count: number) => nutrientsFor(food, portion.grams * count),
      gramsAt: (count: number) => portion.grams * count,
      summaryAt: (count: number) => `${Math.round(portion.grams * count)} g`,
      step: 0.5,
      min: 0.5,
    })),
    {
      id: GRAMS,
      label: 'grams',
      nutrientsAt: (count: number) => nutrientsFor(food, count),
      gramsAt: (count: number) => count,
      summaryAt: (count: number) => `${Math.round(count)} g`,
      // Bigger steps on bigger amounts: nudging 250 g of rice by 1 g is thirty taps to a
      // difference nobody can taste.
      step: 10,
      min: 1,
    },
  ]

  return {
    title: food.description,
    subtitle: `${food.brand ? `${food.brand} · ` : ''}${food.per100.kcal} kcal / 100 g`,
    units,
    // A food with no portions — most branded rows, any own food with no stated serving — opens in
    // grams, so it never opens on an empty box with a disabled button.
    initialUnitId: (food.portions.find((row) => row.isDefault) ?? food.portions[0])?.id ?? GRAMS,
    isComposite: false,
    log: (unit, count, target) =>
      repo
        .logFood({
          food,
          meal: target.meal,
          eatenAt: target.at,
          venue: target.venue,
          source: food.barcode ? 'barcode' : 'search',
          ...(unit.id === GRAMS
            ? { grams: count }
            : { portionId: unit.id, portionCount: count }),
        })
        .then(() => 1),
  }
}

function recipeSubject(recipe: Recipe): AddSubject {
  const each = perServing(recipe)
  const batch = Math.max(1, recipe.servings)
  const unit: AddUnit = {
    id: 'serving',
    label: 'serving',
    nutrientsAt: (count) => scale(recipe.nutrients, count / batch),
    gramsAt: () => null,
    // The one place the batch size belongs: beside the number being logged. As part of the heading
    // it read as the amount ("7 servings"), which is the opposite of what the box was set to.
    summaryAt: (count) =>
      count >= batch ? `the whole recipe (${batch})` : `${count} of ${batch} servings`,
    step: 0.5,
    min: 0.5,
  }
  return {
    title: recipe.name,
    subtitle: `${each.kcal} kcal a serving`,
    units: [unit],
    initialUnitId: unit.id,
    isComposite: true,
    log: (_unit, count, target) =>
      repo.logRecipeIngredients(recipe, count, target.meal, target.at),
  }
}

function mealSubject(template: MealTemplate): AddSubject {
  const unit: AddUnit = {
    id: 'portion',
    label: template.items.length === 1 ? 'of this' : 'of this meal',
    nutrientsAt: (count) => scale(template.nutrients, count),
    gramsAt: (count) =>
      template.items.reduce((total, item) => total + item.grams, 0) * count || null,
    summaryAt: (count) => plural(template.items.length * count, 'item'),
    step: 0.5,
    min: 0.5,
  }
  return {
    title: template.name,
    subtitle: `Saved · ${template.nutrients.kcal} kcal`,
    units: [unit],
    initialUnitId: unit.id,
    isComposite: true,
    log: (_unit, count, target) =>
      repo.logMealTemplate(template, target.meal, target.at, count, target.venue),
  }
}

function dishSubject(dish: RecentDish): AddSubject {
  const unit: AddUnit = {
    id: 'copy',
    label: dish.parts.length > 1 ? 'of this dish' : 'of this',
    nutrientsAt: (count) => scale(dish.nutrients, count),
    gramsAt: () => null,
    summaryAt: (count) => plural(dish.parts.length * count, 'item'),
    // Whole copies only. A dish is already "3 steak tacos" as logged, and 1.5 of it means nothing
    // — the way to have one taco is to save it as one, which the breakdown screen offers.
    step: 1,
    min: 1,
  }
  return {
    title: dish.name,
    subtitle: `${dish.nutrients.kcal} kcal`,
    units: [unit],
    initialUnitId: unit.id,
    isComposite: true,
    log: (_unit, count, target) =>
      repo.logDishAgain(dish.dishId, { meal: target.meal, at: target.at, multiple: count }),
  }
}

function quickSubject(quick: RecentQuick): AddSubject {
  const unit: AddUnit = {
    id: 'copy',
    label: 'of this',
    nutrientsAt: (count) => scale(quick.nutrients, count),
    gramsAt: () => null,
    summaryAt: (count) => (count === 1 ? 'as logged before' : `${count} of them`),
    step: 0.5,
    min: 0.5,
  }
  return {
    title: quick.name,
    subtitle: `${quick.nutrients.kcal} kcal · calories and macros only`,
    units: [unit],
    initialUnitId: unit.id,
    isComposite: false,
    log: (unit_, count, target) =>
      repo
        .logQuickAdd(unit_.nutrientsAt(count), target.meal, quick.name, target.at, target.venue)
        .then(() => 1),
  }
}

export interface Suggestion {
  key: string
  title: string
  nutrients: Nutrients
  detail: string
  loggable: Loggable
}

export interface Repeatable extends Suggestion {
  logAgain: (target: LogTarget) => Promise<number>
}

export function fromRecent(item: RecentItem): Repeatable {
  switch (item.kind) {
    case 'food': {
      const grams = amountGrams(item.food, item.amount)
      return {
        key: `f:${item.food.id}`,
        title: item.food.description,
        nutrients: nutrientsFor(item.food, grams),
        detail: withTimes(describeAmount(item.food, item.amount), item.times),
        loggable: { kind: 'food', food: item.food },
        logAgain: (target) =>
          repo.logFoods([item.food], {
            meal: target.meal,
            eatenAt: target.at,
            venue: target.venue,
          }),
      }
    }
    case 'dish':
      return {
        key: `d:${item.dishId}`,
        title: item.name,
        nutrients: item.nutrients,
        detail: withTimes(item.parts.join(', '), item.times),
        loggable: { kind: 'dish', dish: item },
        logAgain: (target) => repo.logDishAgain(item.dishId, { meal: target.meal, at: target.at }),
      }
    case 'quick':
      return {
        key: `q:${item.name}`,
        title: item.name,
        nutrients: item.nutrients,
        detail: withTimes('calories only', item.times),
        loggable: { kind: 'quick', quick: item },
        logAgain: (target) =>
          repo
            .logQuickAdd(item.nutrients, target.meal, item.name, target.at, target.venue)
            .then(() => 1),
      }
  }
}

export function fromLibrary(hit: LibraryHit): Suggestion {
  switch (hit.kind) {
    case 'recipe':
      return {
        key: `r:${hit.recipe.id}`,
        title: hit.name,
        nutrients: perServing(hit.recipe),
        detail: 'a serving',
        loggable: { kind: 'recipe', recipe: hit.recipe },
      }
    case 'meal':
      return {
        key: `m:${hit.template.id}`,
        title: hit.name,
        nutrients: hit.template.nutrients,
        detail: 'saved',
        loggable: { kind: 'meal', template: hit.template },
      }
    case 'dish':
      return fromRecent(hit.dish)
    case 'quick':
      return fromRecent(hit.quick)
  }
}

/**
 * How often it's been eaten, said in words.
 *
 * It was a bare "2×" floating at the end of the row, which states a number without its unit: two
 * portions? twice today? Folded into the detail line, where the sentence can carry the window.
 */
export function withTimes(detail: string, times: number): string {
  if (times < 2) return detail
  return [detail, `${times} times this month`].filter(Boolean).join(' · ')
}

export interface LoggablePart {
  label: string
  /** For one of the subject's units, scaled by the panel. */
  nutrients: Nutrients
  grams: number
}

/**
 * What a composite contains, per one unit of it.
 *
 * Read here rather than passed in, because the labels come from `foods` and only the recipe and the
 * saved meal know which ids they need. The dish reads its own rows back: `RecentDish` carries part
 * *names* for its subtitle, and this screen wants each part's macros too.
 */
export async function partsOf(loggable: Loggable): Promise<LoggablePart[]> {
  if (loggable.kind === 'food' || loggable.kind === 'quick') return []

  if (loggable.kind === 'recipe') {
    const { recipe } = loggable
    const foods = await repo.foodsByIds(
      recipe.ingredients.map((row) => row.foodId).filter((id): id is string => id !== null),
    )
    const share = 1 / Math.max(1, recipe.servings)
    return recipe.ingredients.map((ingredient) => {
      const food = ingredient.foodId === null ? undefined : foods.get(ingredient.foodId)
      const grams = ingredient.grams * share
      return {
        label: food?.description ?? ingredient.label,
        grams,
        // A part whose food is missing contributes nothing, and shows as a visible zero.
        nutrients: food ? nutrientsFor(food, grams) : EMPTY_NUTRIENTS,
      }
    })
  }

  if (loggable.kind === 'meal') {
    const { template } = loggable
    const foods = await repo.foodsByIds(
      template.items.map((row) => row.foodId).filter((id): id is string => id !== null),
    )
    return template.items.map((item) => ({
      label: (item.foodId ? foods.get(item.foodId)?.description : null) ?? 'Quick add',
      grams: item.grams,
      nutrients: item.nutrients,
    }))
  }

  const rows = await repo.dishEntries(loggable.dish.dishId)
  const foods = await repo.foodsByIds(
    rows.map((row) => row.foodId).filter((id): id is string => id !== null),
  )
  return rows.map((row) => ({
    label: (row.foodId ? foods.get(row.foodId)?.description : null) ?? row.note ?? 'Item',
    grams: row.grams,
    nutrients: row.nutrients,
  }))
}

const plural = (count: number, word: string): string =>
  `${Math.round(count)} ${word}${Math.round(count) === 1 ? '' : 's'}`
