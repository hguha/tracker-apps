import { householdPortions } from '@/lib/nutrition'
import { haystackOf, overlapScore, queryTerms, rankFoods } from '@/lib/foodSearch'
import { parseIngredientLine } from '@/lib/parseIngredient'
import { volumeDensity } from '@/lib/volume'
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
const NOISE = /\b(yields|ns as to|raw|crumbs|crushed|crumbled)\b|^\s*[\d./]+\s*oz\b/i
const RESTAURANT = /^[A-Z][A-Z'&.\s-]+,/

const singular = (word: string): string =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word

const STATE_WORDS = new Set([
  'raw', 'cooked', 'frozen', 'dry', 'canned', 'fresh', 'boiled', 'drained', 'unprepared',
  'prepared', 'toasted', 'plain', 'nfs', 'regular', 'commercial', 'commercially', 'refrigerated',
  'baked', 'fried', 'roasted', 'whole', 'low', 'sodium', 'salt', 'without', 'added', 'sugar',
])

const GENERIC_KINDS = new Set(['candy', 'food', 'bar', 'product', 'snack', 'type', 'style'])

const withoutChain = (description: string): string => {
  const rest = description.replace(/\([^)]*\)/g, '').replace(RESTAURANT, '')
  return /[a-z]/.test(rest) ? rest : description
}

const significant = (text: string): string[] =>
  queryTerms(text)
    .filter((word) => /^[a-z]{3,}$/.test(word) && !HEAD_FILLERS.has(word))
    .map(singular)

function namedKind(description: string): string[] {
  const [first = '', second = ''] = withoutChain(description).split(',')
  const category = significant(first)
  if (category.length !== 1) return []
  return significant(second).filter(
    (word) => !STATE_WORDS.has(word) && !GENERIC_KINDS.has(word) && word !== category[0],
  )
}

function kindNoun(description: string): string | null {
  const second = withoutChain(description).split(',')[1] ?? ''
  const words = significant(second)
  return words.length >= 2 && namedKind(description).length > 0 ? words[words.length - 1]! : null
}

const isLabelDump = (description: string): boolean => !/[a-z]/.test(description)

function headNoun(description: string): string | null {
  const name = (withoutChain(description).split(',')[0] ?? '').split(/\s(?:with|without|in|on|for)\s/i)[0] ?? ''
  const words = queryTerms(name).filter(
    (word) => /^[a-z]{3,}$/.test(word) && !HEAD_FILLERS.has(word),
  )
  return words.length === 0 ? null : singular(words[words.length - 1]!)
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

export interface Lender {
  food: Food
  names: Set<string>
  words: Set<string>
  haystack: string
  portions: FoodPortion[]
  volumes: FoodPortion[]
}

export function lendersFrom(candidates: readonly { food: Food; haystack?: string }[]): Lender[] {
  return candidates.flatMap(({ food, haystack }) => {
    if (!isGeneric(food)) return []
    const head = headNoun(food.description)
    const portions = lendablePortions(food)
    if (head === null || portions.length === 0) return []
    return [
      {
        food,
        names: new Set([head, kindNoun(food.description)].filter((name) => name !== null)),
        words: new Set(significant(food.description)),
        haystack: haystack ?? haystackOf(food),
        portions,
        volumes: portions.filter(isVolume),
      },
    ]
  })
}

export function closestGeneric(food: Food, lenders: readonly Lender[]): LentPortions | null {
  if (volumeDensity(food) !== null) return null
  const volumeOnly = householdPortions(food).length > 0
  const head = headNoun(food.description)
  if (head === null) return null
  const terms = queryTerms(food.description)
  const kind = namedKind(food.description)
  const own = significant(food.description)
  if (isLabelDump(food.description) && own.length > 6) return null
  const scored = lenders
    .filter((lender) => lender.food.id !== food.id && lender.names.has(head))
    .filter((lender) => kind.length === 0 || kind.some((word) => lender.words.has(word)))
    .map((lender) => ({ lender, portions: volumeOnly ? lender.volumes : lender.portions }))
    .filter(({ portions }) => portions.length > 0)
    .map((entry) => ({ ...entry, overlap: overlapScore(entry.lender.haystack, terms) }))
  if (scored.length === 0) return null
  const best = Math.max(...scored.map((entry) => entry.overlap))
  const top = scored.filter((entry) => entry.overlap === best)
  const [from] = rankFoods(
    top.map((entry) => entry.lender.food),
    head,
    1,
  )
  const chosen = top.find((entry) => entry.lender.food.id === from?.id)
  return chosen ? { from: chosen.lender.food, portions: chosen.portions } : null
}
