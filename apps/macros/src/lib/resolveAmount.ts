import { ML_PER, type AmountUnit, type ParsedIngredient } from '@/lib/parseIngredient'
import type { Food } from '@/domain/types'
import { portionFor } from '@/lib/nutrition'

/**
 * Turning "2 cups" into grams, using the food it refers to.
 *
 * A cup of flour is 120 g and a cup of oil is 218 g, so no table of volumes can convert one without
 * knowing what's in it. USDA already answers this: most rows carry portions like "1 cup", "1 clove",
 * "1 medium", each with a gram weight measured for that food. Matching the parsed unit against those
 * is exact where a density table would be a guess.
 *
 * Order of preference, and each step is a real drop in confidence:
 *  1. The unit is already a mass — no food knowledge needed at all.
 *  2. The food has a portion whose label means the same unit ("1 cup" for `cup`).
 *  3. The food states a density (`gramsPerMl`) and the unit is a volume.
 *  4. The food has a default portion and the unit counts things — "1 onion" is one portion of onion.
 *  5. Water's density, for volumes only, flagged as a guess.
 *
 * Nothing invents a figure for a countable unit with no portion to count: "3 sprigs thyme" against a
 * row with no per-sprig weight returns null, and a row the user can see is uncounted beats a number
 * that came from nowhere.
 */

export interface ResolvedAmount {
  grams: number | null
  /** How it was worked out, so the UI can be honest about which rows are guesses. */
  basis: 'mass' | 'portion' | 'density' | 'assumed-water' | 'unresolved'
}

const MASS_UNITS = new Set<AmountUnit>(['g', 'kg', 'oz', 'lb'])

/**
 * Portion labels that mean each unit.
 *
 * Matched loosely against the label's words: USDA writes "1 cup, chopped", "1 cup (8 fl oz)",
 * "1 medium (2-1/2" dia)", so an equality test finds almost nothing.
 */
const PORTION_WORDS: Partial<Record<AmountUnit, string[]>> = {
  cup: ['cup'],
  tbsp: ['tbsp', 'tablespoon'],
  tsp: ['tsp', 'teaspoon'],
  'fl-oz': ['fl oz', 'fluid ounce'],
  clove: ['clove'],
  slice: ['slice'],
  can: ['can', 'container', 'package'],
  package: ['package', 'container', 'can'],
  stalk: ['stalk', 'rib', 'stick'],
  head: ['head'],
  sprig: ['sprig'],
  bunch: ['bunch'],
  piece: ['medium', 'each', 'whole', 'fruit', 'piece', 'large', 'small', 'serving'],
}

export function resolveAmount(parsed: ParsedIngredient, food: Food | null): ResolvedAmount {
  // 1. Already a mass. `parseIngredientLine` has done this; repeated here so callers have one door.
  if (parsed.grams !== null) return { grams: parsed.grams, basis: 'mass' }

  const { quantity, unit } = parsed
  if (quantity === null || unit === null || food === null) {
    return { grams: null, basis: 'unresolved' }
  }
  if (MASS_UNITS.has(unit)) return { grams: null, basis: 'unresolved' }

  // 2. A portion of this very food that means the same thing.
  const portion = matchPortion(food, unit)
  if (portion) return { grams: Math.round(quantity * portion.grams), basis: 'portion' }

  const ml = ML_PER[unit]

  // 3. A stated density.
  if (ml !== undefined && food.gramsPerMl !== null && food.gramsPerMl > 0) {
    return { grams: Math.round(quantity * ml * food.gramsPerMl), basis: 'density' }
  }

  // 4. A bare count against the food's default portion: "1 onion" is one portion of onion.
  //
  // Only a bare count. Any *named* unit that got this far has no portion meaning it (step 2 failed),
  // and reading it as one serving of the food is how "1 pinch of saffron" became a 283 g portion of
  // chicken biryani and put 461 kcal into a recipe. A pinch is not a serving, a sprig of thyme is not
  // a serving of thyme, and a row the user can see is uncounted beats a number from nowhere.
  if (ml === undefined) {
    if (unit !== 'piece') return { grams: null, basis: 'unresolved' }
    const fallback = portionFor(food, null)
    if (fallback) return { grams: Math.round(quantity * fallback.grams), basis: 'portion' }
    return { grams: null, basis: 'unresolved' }
  }

  // 5. Water. Only for volumes, and only said as a guess — for a liquid it's near enough, and for
  // a dry good the user can see the row and fix it.
  return { grams: Math.round(quantity * ml), basis: 'assumed-water' }
}

function matchPortion(food: Food, unit: AmountUnit) {
  const words = PORTION_WORDS[unit]
  if (!words) return null
  return (
    food.portions.find((portion) => {
      const label = portion.label.toLowerCase()
      // "1 cup" and "2 cups" both mean a cup; the count in the label is already in `grams`, so
      // only labels that describe a single one of the unit are usable.
      if (!/^1\b|^one\b/.test(label) && !words.some((word) => label.startsWith(word))) return false
      return words.some((word) => label.includes(word))
    }) ?? null
  )
}

/** Whether a resolved figure is trustworthy enough not to warn about. */
export const isConfident = (basis: ResolvedAmount['basis']): boolean =>
  basis === 'mass' || basis === 'portion' || basis === 'density'
