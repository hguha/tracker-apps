import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { rankFoods } from '@/lib/foodSearch'
import type { Food } from '@/domain/types'

/**
 * One ingredient name to one food row — the app's single matcher.
 *
 * There were two, and they disagreed. Both also required *every* word of a name to appear in one
 * description, which is a rule that can only work when the person and the database happen to use the
 * same vocabulary: "lasagna noodles, dry" matched nothing, because USDA files it under "Noodles, egg,
 * dry". An unmatched row contributes zero calories, so a miss here doesn't look like a miss — it
 * looks like the food being free.
 *
 * **The fix is to stop re-filtering the search engine's answer.** USDA's own relevance ranking
 * handles synonymy perfectly well — it returns the right row for "heavy whipping cream", "scallions"
 * and "Italian sausage" — and the bug was fetching those results and then throwing them away with an
 * all-terms rule. So the remote step now hands its candidates straight to `rankFoods`, and the
 * hand-written alias table that used to paper over this is gone.
 *
 * Three steps, cheapest first:
 *  1. Local, all terms. Free, offline, and right for anything already logged.
 *  2. Remote, ranked but not filtered — one request, whatever the database thinks is closest.
 *  3. Local, best partial overlap. The offline fallback: a row sharing the head noun beats nothing.
 */
export async function matchIngredient(name: string): Promise<MatchedFood> {
  const query = name.trim()
  if (query.length < 2) return NO_MATCH

  const [exact] = await repo.searchFoods(query, 1)
  if (exact) return { food: exact, matchedBy: 'exact' }

  // Generic sources only: these are ingredients, and Open Food Facts' packaged rows are both the
  // wrong answer for "cooked spaghetti" and the slowest part of resolving a whole recipe.
  const remote = await searchRemote(query, { branded: false })
  const [best] = rankFoods(remote, query, 1)
  if (best) return { food: best, matchedBy: 'fuzzy' }

  const [loose] = await repo.searchFoodsLoose(query, 1)
  return loose ? { food: loose, matchedBy: 'fuzzy' } : NO_MATCH
}

export interface MatchedFood {
  food: Food | null
  /** `exact` when the name as written matched every word; `fuzzy` when relevance found it. */
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
}

const NO_MATCH: MatchedFood = { food: null, matchedBy: 'unmatched' }
