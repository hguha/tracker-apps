import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { searchVariants } from '@/lib/foodSearch'
import type { Food } from '@/domain/types'

/**
 * One ingredient name to one food row — the app's single matcher.
 *
 * There were two, and they disagreed. `data/ingredientLines` retried on the head noun; `features/log/estimate`
 * didn't, so the same name resolved from a pasted recipe and came back unmatched from an AI
 * breakdown. Worse, both required *every* word of the name to appear in one description, which is a
 * rule that can only work when the person and the database happen to use the same vocabulary:
 * "lasagna noodles, dry" matched nothing at all, because USDA calls it "Pasta, dry, enriched".
 *
 * An unmatched row contributes zero calories to the meal, so a miss here doesn't look like a miss —
 * it looks like the food being free. That is the worst failure this app can have, and it is why the
 * search relaxes rather than giving up.
 *
 * Order: every variant locally, then one remote round for the two most specific variants, then
 * locally again. Local-first because a second import of the same recipe should cost no requests, and
 * only two variants go out because nineteen ingredients × six variants is a rate limit.
 */
export async function matchIngredient(name: string): Promise<MatchedFood> {
  const variants = searchVariants(name)
  if (variants.length === 0) return { food: null, matchedBy: 'unmatched', usedQuery: null }

  const localHit = await firstLocal(variants)
  if (localHit) return localHit

  // Generic sources only: these are ingredients, and Open Food Facts' packaged rows are both the
  // wrong answer for "cooked spaghetti" and the slowest part of resolving a whole recipe.
  await Promise.all(
    variants.slice(0, 2).map((variant) => searchRemote(variant, { branded: false })),
  )

  return (await firstLocal(variants)) ?? { food: null, matchedBy: 'unmatched', usedQuery: null }
}

export interface MatchedFood {
  food: Food | null
  /** `exact` when the name as written matched; `fuzzy` when a relaxation or an alias did. */
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
  /** Which query found it, so a surprising match is explainable rather than mysterious. */
  usedQuery: string | null
}

async function firstLocal(variants: readonly string[]): Promise<MatchedFood | null> {
  for (const [index, variant] of variants.entries()) {
    const [found] = await repo.searchFoods(variant, 1)
    if (found) {
      return { food: found, matchedBy: index === 0 ? 'exact' : 'fuzzy', usedQuery: variant }
    }
  }
  return null
}
