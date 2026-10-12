import { capitalise } from '@tracker-engine/core'
import { householdPortions, median, medianNutrients, portionFor } from '@/lib/nutrition'
import { matchesQuery, normalizeQuery, queryTerms } from '@/lib/foodSearch'
import { ingredientMatcher } from '@/lib/ingredientMatch'
import type { Food, FoodPortion } from '@/domain/types'

const AVERAGE = 'average'

const MIN_SOURCES = 3
const MIN_MAKERS = 2
const NOT_AS_EATEN =
  /\b(raw|dry|dried|uncooked|powder|mix|dehydrated|concentrate|unprepared|baby food|sauce)\b/i

export const isAverage = (food: Pick<Food, 'dataType'>): boolean => food.dataType === AVERAGE

export function averageFood(query: string, foods: readonly Food[]): Food | null {
  const terms = queryTerms(query)
  if (terms.length === 0) return null
  const asked = normalizeQuery(query)
  const names = ingredientMatcher(query)
  const allowsUncooked = NOT_AS_EATEN.test(asked)
  const pool = foods.filter(
    (food) =>
      !isAverage(food) &&
      matchesQuery(food, terms) &&
      names(food) &&
      (allowsUncooked || !NOT_AS_EATEN.test(food.description)),
  )
  const makers = new Set(pool.map((food) => food.brand?.trim().toLowerCase()).filter(Boolean))
  if (pool.length < MIN_SOURCES || makers.size < MIN_MAKERS) return null

  const densities = pool.map((food) => food.gramsPerMl).filter((value): value is number => !!value)
  return {
    id: `${AVERAGE}:${asked}`,
    source: 'custom',
    description: capitalise(asked),
    brand: `Average of ${pool.length}`,
    barcode: null,
    category: null,
    dataType: AVERAGE,
    per100: medianNutrients(pool.map((food) => food.per100)),
    gramsPerMl: median(densities),
    portions: sharedPortions(pool),
    verifiedAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 0,
  }
}

function sharedPortions(pool: readonly Food[]): FoodPortion[] {
  const servings = pool
    .map((food) => portionFor(food, null))
    .filter((portion): portion is FoodPortion => portion !== null && portion.grams > 0)
    .map((portion) => portion.grams)
  const byLabel = new Map<string, number[]>()
  for (const food of pool) {
    for (const portion of householdPortions(food)) {
      const label = portion.label.trim().toLowerCase()
      if (label === '1 serving') continue
      const weights = byLabel.get(label)
      if (weights) weights.push(portion.grams)
      else byLabel.set(label, [portion.grams])
    }
  }
  const shared = [...byLabel]
    .filter(([, grams]) => grams.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .map(([label, grams]) => ({
      id: `avg-${label.replace(/[^a-z0-9]+/g, '-')}`,
      label,
      grams: Math.round(median(grams)!),
      isDefault: false,
    }))
  const serving = median(servings)
  return serving === null
    ? shared.map((portion, index) => ({ ...portion, isDefault: index === 0 }))
    : [{ id: 'avg-serving', label: '1 serving', grams: Math.round(serving), isDefault: true }, ...shared]
}
