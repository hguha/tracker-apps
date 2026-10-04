import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { matchesQuery, queryTerms, rankFoods } from '@/lib/foodSearch'
import { ingredientQueries, namesIngredient } from '@/lib/ingredientMatch'
import type { Food } from '@/domain/types'

export async function matchIngredient(name: string): Promise<MatchedFood> {
  const query = name.trim()
  if (query.length < 2) return NO_MATCH

  for (const variant of ingredientQueries(query)) {
    const local = (await repo.searchFoods(variant, INGREDIENT_CANDIDATES)).find((food) =>
      namesIngredient(food, query),
    )
    if (local) return found(local, query)

    const remote = await searchRemote(variant, { branded: false, limit: INGREDIENT_CANDIDATES })
    const best = rankFoods(remote, variant, INGREDIENT_CANDIDATES).find((food) =>
      namesIngredient(food, query),
    )
    if (best) return found(best, query)
  }
  return NO_MATCH
}

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
