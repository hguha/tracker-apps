import { mgToGrams, nutrientsFor, portionFor, proteinPer100Kcal } from '@/lib/nutrition'
import type { Food, MacroTargets, Nutrients } from '@/domain/types'

/**
 * What to eat next, from what's left of today.
 *
 * Deliberately arithmetic rather than a model call: the useful question at 8pm is "what fits in
 * 400 kcal and 40 g of protein", which is a ranking problem over foods the user already eats.
 * A model would be slower, needs a network, and would invent foods that aren't in the database
 * — and the coach is there for anyone who wants a conversation about it.
 */

export interface Suggestion {
  food: Food
  grams: number
  nutrients: Nutrients
  /** Why this is being offered, in the user's own numbers. */
  why: string
}

/** Below this, "what fits" isn't a useful question any more. */
const MIN_USEFUL_KCAL = 120
/** A little overshoot is fine; a lot isn't. */
const KCAL_TOLERANCE = 1.1

export function suggestFoods(
  remaining: MacroTargets,
  candidates: readonly Food[],
  limit = 5,
): Suggestion[] {
  if (remaining.kcal < MIN_USEFUL_KCAL) return []

  const proteinShort = remaining.proteinMg > 0
  const options = candidates
    .map((food) => {
      const portion = portionFor(food, null)
      const grams = portion ? portion.grams : 100
      return { food, grams, nutrients: nutrientsFor(food, grams) }
    })
    .filter((option) => option.nutrients.kcal > 0)
    .filter((option) => option.nutrients.kcal <= remaining.kcal * KCAL_TOLERANCE)

  const scored = options.map((option) => ({
    ...option,
    score: proteinShort
      ? // Behind on protein: the best food is the one that closes the most of that gap per
        // calorie spent, which is exactly protein density.
        proteinPer100Kcal(option.nutrients)
      : // Protein already met: prefer whatever fills the remaining calories most neatly, so
        // the suggestion doesn't blow the budget or leave an awkward 300 kcal behind.
        -Math.abs(option.nutrients.kcal - remaining.kcal),
  }))

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ food, grams, nutrients }) => ({
      food,
      grams,
      nutrients,
      why: proteinShort
        ? `${Math.round(mgToGrams(nutrients.proteinMg))} g protein for ${nutrients.kcal} kcal`
        : `${nutrients.kcal} kcal of the ${remaining.kcal} you have left`,
    }))
}
