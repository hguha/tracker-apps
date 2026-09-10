import { mgToGrams } from '@/lib/nutrition'

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
