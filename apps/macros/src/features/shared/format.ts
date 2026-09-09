import { mgToGrams } from '@/lib/nutrition'

export const grams = (mg: number): string => `${Math.round(mgToGrams(mg))}g`
export const kcal = (value: number): string => `${Math.round(value)}`

export const MACRO_META = [
  { key: 'proteinMg', label: 'Protein', bar: 'bg-protein' },
  { key: 'carbsMg', label: 'Carbs', bar: 'bg-carbs' },
  { key: 'fatMg', label: 'Fat', bar: 'bg-fat' },
] as const

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
