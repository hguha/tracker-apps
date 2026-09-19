import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { matchesQuery, queryTerms, rankFoods } from '@/lib/foodSearch'
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
 * Two steps, cheapest first:
 *  1. Local. Free, offline, and right for anything already logged. `searchFoods` relaxes to partial
 *     matches when nothing matches every word, so this is also the offline answer for an unfamiliar
 *     name — a row sharing the head noun beats an unmatched line.
 *  2. Remote, ranked but not filtered — one request, whatever the database thinks is closest.
 *
 * `matchedBy` is decided here rather than taken from whichever step answered, because "the name
 * matched as written" is a fact about the row, not about where it came from — and `searchFoods` is
 * allowed to relax, so the first step's hit is not necessarily exact.
 */
export async function matchIngredient(name: string): Promise<MatchedFood> {
  const query = name.trim()
  if (query.length < 2) return NO_MATCH

  const [local] = await repo.searchFoods(query, 1)
  if (local) return found(local, query)

  // Generic sources only, and a short page: these are ingredients, Open Food Facts' packaged rows
  // are the wrong answer for "cooked spaghetti", and only the top hit is ever used — the function
  // fetches full details for everything it returns, so a shorter page is a third off the wait.
  const remote = await searchRemote(query, { branded: false, limit: INGREDIENT_CANDIDATES })
  const [best] = rankFoods(remote, query, 1)
  return best ? found(best, query) : NO_MATCH
}

const found = (food: Food, query: string): MatchedFood => ({
  food,
  matchedBy: matchesQuery(food, queryTerms(query)) ? 'exact' : 'fuzzy',
})

export interface MatchedFood {
  food: Food | null
  /** `exact` when the name as written matched every word; `fuzzy` when relevance found it. */
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
}

const NO_MATCH: MatchedFood = { food: null, matchedBy: 'unmatched' }

/** Enough for `rankFoods` to have a real choice, few enough to be quick. Measured; see above. */
const INGREDIENT_CANDIDATES = 8
