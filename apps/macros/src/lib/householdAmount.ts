import { formatQuantity } from '@/lib/parseIngredient'
import type { Food, FoodPortion } from '@/domain/types'

/**
 * Grams, said back as the measure a cook would have used.
 *
 * "363 g of flour" is true and useless: nobody on imperial units has ever weighed flour, and a
 * recipe that reads in grams when the kitchen has cups and spoons is a recipe you can't follow.
 * Grams stay canonical — every nutrient in the app is computed from them — so this is a *display* of
 * the same number and nothing here feeds arithmetic.
 *
 * Derived from the food's own USDA portions, never from a density table, because a cup of flour is
 * 120 g and a cup of oil is 218 g: the only honest conversion is the one somebody measured for this
 * food. A food with no volume portion gets no household amount, and the grams stand on their own.
 *
 * Volumes only. A counted thing ("1 onion", "9 lasagna noodles") comes through
 * `RecipeIngredient.amount` — what the recipe actually said — which beats any reconstruction.
 */

/** Words in a USDA portion label that mean a volume, with how to write them. */
const VOLUMES: { words: string[]; one: string; many: string }[] = [
  { words: ['cup'], one: 'cup', many: 'cups' },
  { words: ['tbsp', 'tablespoon'], one: 'tbsp', many: 'tbsp' },
  { words: ['tsp', 'teaspoon'], one: 'tsp', many: 'tsp' },
  { words: ['fl oz', 'fluid ounce'], one: 'fl oz', many: 'fl oz' },
]

/**
 * How far a rounded count may sit from the true weight.
 *
 * A household measure is an approximation by nature, but past this it stops describing the number
 * printed next to it: a tenth of a cup of flour is a rounded tablespoon, and two figures on one row
 * that disagree by that much is worse than one unfamiliar figure on its own.
 */
const TOLERANCE = 0.06

/** Beyond this a count has stopped being readable: "23 cups" is not how anyone measures. */
const MAX_COUNT = 12

export function householdAmount(grams: number, food: Food | undefined | null): string | null {
  if (!food || !(grams > 0)) return null

  // Largest measure first, so 363 g of flour reads as cups rather than as 24 tablespoons.
  const candidates = food.portions
    .flatMap((portion) => {
      const volume = volumeOf(portion)
      return volume && portion.grams > 0 ? [{ portion, volume }] : []
    })
    .sort((a, b) => b.portion.grams - a.portion.grams)

  for (const { portion, volume } of candidates) {
    const exact = grams / portion.grams
    const count = snap(exact)
    if (count < 0.25 || count > MAX_COUNT) continue
    if (Math.abs(count * portion.grams - grams) > TOLERANCE * grams) continue
    // Singular at or below one: "½ cups" is not English, and a recipe writes "½ cup".
    return `${formatQuantity(count)} ${count <= 1 ? volume.one : volume.many}`
  }
  return null
}

function volumeOf(portion: FoodPortion): (typeof VOLUMES)[number] | null {
  const label = portion.label.toLowerCase()
  // "1 cup, chopped" is a cup; "2 cups" already has its count folded into `grams`, so only labels
  // describing a single one of the measure can be counted against.
  if (!/^(1|one)\b/.test(label.trim())) return null
  return VOLUMES.find((volume) => volume.words.some((word) => label.includes(word))) ?? null
}

/** Quarters while the count is small, then halves, then whole — how measures are actually read. */
function snap(count: number): number {
  if (count < 3) return Math.round(count * 4) / 4
  if (count < 10) return Math.round(count * 2) / 2
  return Math.round(count)
}

