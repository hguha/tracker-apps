import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { matchesQuery, queryTerms, rankFoods } from '@/lib/foodSearch'
import { ingredientMatcher, ingredientQueries } from '@/lib/ingredientMatch'
import { resolveAmount } from '@/lib/resolveAmount'
import type { AmountUnit } from '@/lib/parseIngredient'
import type { Food } from '@/domain/types'

export async function matchIngredient(
  name: string,
  unit: AmountUnit | null = null,
): Promise<MatchedFood> {
  const query = name.trim()
  if (query.length < 2) return NO_MATCH

  const names = ingredientMatcher(query)
  const pick = (foods: Food[]): Food | undefined => {
    const candidates = foods.filter(names)
    return candidates.find((food) => canWeigh(food, unit)) ?? candidates[0]
  }
  for (const variant of ingredientQueries(query)) {
    const local = pick(await repo.searchFoods(variant, INGREDIENT_CANDIDATES))
    if (local) return found(local, query)

    const remote = await searchRemote(variant, { branded: false, limit: INGREDIENT_CANDIDATES })
    const best = pick(rankFoods(remote, variant, INGREDIENT_CANDIDATES))
    if (best) return found(best, query)
  }
  return NO_MATCH
}

const canWeigh = (food: Food, unit: AmountUnit | null): boolean =>
  unit === null ||
  resolveAmount(
    { raw: '', name: '', quantity: 1, unit, grams: null, note: '', isToTaste: false },
    food,
  ).grams !== null

const found = (food: Food, query: string): MatchedFood => ({
  food,
  matchedBy: matchesQuery(food, queryTerms(query)) ? 'exact' : 'fuzzy',
})

interface MatchedFood {
  food: Food | null
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
}

const NO_MATCH: MatchedFood = { food: null, matchedBy: 'unmatched' }

const INGREDIENT_CANDIDATES = 8
