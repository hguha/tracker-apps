import { householdPortions } from '@/lib/nutrition'
import { haystackOf, overlapScore, queryTerms, rankFoods } from '@/lib/foodSearch'
import { parseIngredientLine } from '@/lib/parseIngredient'
import type { Food, FoodPortion } from '@/domain/types'

export interface LentPortions {
  from: Food
  portions: FoodPortion[]
}

const HEAD_FILLERS = new Set([
  'with',
  'and',
  'style',
  'flavor',
  'flavored',
  'flavour',
  'original',
  'classic',
  'mix',
])

const VOLUME_UNITS = new Set(['cup', 'tbsp', 'tsp', 'fl-oz'])
const SIZE_WORDS = /\b(serving|order|small|medium|large|regular|piece|slice|bowl|item|patty|bar)\b/i
const NOISE = /\b(yields|ns as to|raw)\b|^\s*[\d./]+\s*oz\b/i
const RESTAURANT = /^[A-Z][A-Z'&.\s-]+,/

const singular = (word: string): string =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word

function headNoun(description: string): string | null {
  const words = queryTerms(description).filter(
    (word) => /^[a-z]{3,}$/.test(word) && !HEAD_FILLERS.has(word),
  )
  return words.length === 0 ? null : words[words.length - 1]!
}

const isGeneric = (food: Food): boolean =>
  food.source === 'usda' &&
  (food.dataType ?? '').toLowerCase() !== 'branded' &&
  !RESTAURANT.test(food.description)

const isVolume = (portion: FoodPortion): boolean => {
  const parsed = parseIngredientLine(portion.label)
  return parsed.quantity !== null && parsed.unit !== null && VOLUME_UNITS.has(parsed.unit)
}

function lendablePortions(food: Food): FoodPortion[] {
  const usable = householdPortions(food).filter((portion) => !NOISE.test(portion.label))
  return [
    ...usable.filter(isVolume),
    ...usable.filter((portion) => !isVolume(portion) && SIZE_WORDS.test(portion.label)),
  ].slice(0, 3)
}

export function closestGeneric(food: Food, candidates: readonly Food[]): LentPortions | null {
  if (householdPortions(food).length > 0) return null
  const head = headNoun(food.description)
  if (head === null) return null
  const headWord = new RegExp(`\\b${singular(head)}s?\\b`)
  const terms = queryTerms(food.description)
  const scored = candidates
    .filter((row) => row.id !== food.id && isGeneric(row))
    .map((row) => ({ row, haystack: haystackOf(row), portions: lendablePortions(row) }))
    .filter(({ haystack, portions }) => portions.length > 0 && headWord.test(haystack))
    .map((entry) => ({ ...entry, overlap: overlapScore(entry.haystack, terms) }))
  if (scored.length === 0) return null
  const best = Math.max(...scored.map((entry) => entry.overlap))
  const top = scored.filter((entry) => entry.overlap === best)
  const [from] = rankFoods(
    top.map((entry) => entry.row),
    head,
    1,
  )
  const chosen = top.find((entry) => entry.row.id === from?.id)
  return chosen ? { from: chosen.row, portions: chosen.portions } : null
}
