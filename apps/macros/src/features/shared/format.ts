import { mgToGrams } from '@/lib/nutrition'

export const grams = (mg: number): string => `${Math.round(mgToGrams(mg))}g`
export const kcal = (value: number): string => `${Math.round(value)}`

export const MACRO_META = [
  { key: 'proteinMg', label: 'Protein', bar: 'bg-protein' },
  { key: 'carbsMg', label: 'Carbs', bar: 'bg-carbs' },
  { key: 'fatMg', label: 'Fat', bar: 'bg-fat' },
] as const
