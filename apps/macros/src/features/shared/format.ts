import type { UnitPreference } from '@tracker-engine/core'
import { mgToGrams, portionFor } from '@/lib/nutrition'
import { householdAmount } from '@/lib/householdAmount'
import type { LastAmount } from '@/data/repository'
import type { Food } from '@/domain/types'

export const grams = (mg: number): string => `${Math.round(mgToGrams(mg))}g`
export const kcal = (value: number): string => `${Math.round(value)}`

/**
 * A portion's label, made safe to show.
 *
 * USDA Survey (FNDDS) foods carry a numeric portion *code* in `modifier` — "10205", "61700" —
 * which the importer used to pass straight through, so logging lasagna offered a row of
 * meaningless five-digit pills. Anything that is only digits and punctuation is therefore
 * replaced by the weight it stands for, which is at least true.
 */
export const portionLabel = (portion: { label: string; grams: number }): string =>
  /[a-z]/i.test(portion.label) ? portion.label : `${Math.round(portion.grams)} g`

/**
 * A portion, with the weight it actually is.
 *
 * USDA's labels are whatever the survey recorded — "4 oz", "1 cup", "1 RACC", "1 medium (2-1/2\"
 * dia)" — so a row of them is a row of mixed units with no common scale, and "1 RACC" means nothing
 * to anybody. Every one of them is stored with a gram weight, and showing it turns an unreadable
 * list into a comparable one: "4 oz · 113 g", "1 RACC · 112 g".
 *
 * Grams, not the user's unit, and deliberately: grams is what the app stores and what a food scale
 * reads, and converting a portion weight to ounces would put two units in one label to no purpose.
 */
export const portionWithGrams = (portion: { label: string; grams: number }): string => {
  const label = portionLabel(portion)
  const weight = `${Math.round(portion.grams)} g`
  return label === weight ? weight : `${label} · ${weight}`
}

/**
 * How much of an ingredient, in the form its reader can measure.
 *
 * Grams lead for someone on metric, because that is what their recipes and their scales say. For
 * someone on imperial they are close to useless — "363 g of flour" cannot be measured with cups and
 * spoons — so the measure leads and the weight follows it. The unit preference already existed and
 * recipes ignored it entirely.
 *
 * Preference order: what the recipe actually said (`RecipeIngredient.amount`), then a volume
 * reconstructed from the food's own USDA portions, then grams alone. Never a guess: see
 * `lib/householdAmount`.
 */
export function ingredientAmount(
  ingredient: { grams: number; amount?: string | null },
  food: Food | undefined | null,
  units: UnitPreference,
): string {
  const weight = ingredient.grams > 0 ? `${Math.round(ingredient.grams)} g` : ''
  const measure = ingredientMeasure(ingredient, food, units)
  if (!measure || measure === weight) return weight
  return weight === '' ? measure : `${measure} · ${weight}`
}

/** The measure on its own, for the places that already show the weight in an input beside it. */
export function ingredientMeasure(
  ingredient: { grams: number; amount?: string | null },
  food: Food | undefined | null,
  units: UnitPreference,
): string | null {
  // With no weight, what the recipe said is the only amount there is — shown whatever the unit
  // preference, because an empty cell is not an amount. "Salt, to taste" and "a pinch of saffron"
  // have no gram figure anybody can honestly supply, and they are still part of the recipe.
  if (!(ingredient.grams > 0)) return ingredient.amount ?? null
  if (units.volume !== 'floz') return null
  return ingredient.amount ?? householdAmount(ingredient.grams, food)
}

/**
 * The grams a one-tap log will use: the amount it was last eaten in, or the food's own portion.
 *
 * Shared, because every one-tap path has to commit the *same* number — the tickboxes on the add
 * screen, and searching the diary from a day. A row that logs blind has to be able to say what it is
 * about to write, and two implementations of "how much" is how those two stop agreeing.
 */
export function amountGrams(
  food: Food,
  last: { grams: number } | null | undefined,
): number {
  if (last && last.grams > 0) return last.grams
  const portion = portionFor(food, null)
  return portion ? portion.grams : 100
}

export function describeAmount(food: Food, last: LastAmount | null | undefined): string {
  const grams = amountGrams(food, last)
  const portion = last?.portionId ? portionFor(food, last.portionId) : null
  const count = last?.portionCount ?? 1
  return portion
    ? `${count} × ${portionLabel(portion)} · ${Math.round(grams)} g`
    : `${Math.round(grams)} g`
}
