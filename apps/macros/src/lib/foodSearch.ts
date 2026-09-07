import type { Food } from '@/domain/types'

/**
 * Ranking for food search. Canonical and tested, because it is what the user actually sees:
 * remote hits are cached locally and then re-queried through here, so this ordering governs
 * both the offline and the online path.
 *
 * The rules exist for concrete failures. Searching "turkey sandwich" returned four ALL-CAPS
 * branded rows with no portion data before any of USDA's composite-dish entries, so a
 * perfectly good "Turkey sandwich on wheat — 1 sandwich" was buried. And "chicken breast"
 * should give the ingredient, not a frozen dinner that happens to contain it.
 */

/** USDA dataset, most trustworthy for a generic query first. */
const DATA_TYPE_SCORE: Record<string, number> = {
  foundation: 6,
  'sr legacy': 5,
  // Composite dishes — "turkey sandwich", "burrito, chicken, cheese". The whole reason a
  // meal can be logged without breaking it into ingredients.
  'survey (fndds)': 5,
  branded: 0,
}

export function scoreFood(food: Food, query: string): number {
  const q = query.trim().toLowerCase()
  const haystack = `${food.description} ${food.brand ?? ''}`.toLowerCase()

  let score = DATA_TYPE_SCORE[(food.dataType ?? '').toLowerCase()] ?? 2

  // A row with no portions can only be logged in raw grams, which is a worse answer to any
  // query. Branded USDA rows are frequently portion-less.
  if (food.portions.length > 0) score += 3

  if (haystack.startsWith(q)) score += 4
  else if (food.description.toLowerCase().startsWith(q)) score += 3

  // ALL-CAPS is the signature of a branded label dump; it reads badly in a list and is
  // usually the less useful match for a generic query.
  if (isShouting(food.description)) score -= 2

  // Prefer the more specific of two equally-typed matches, but only mildly — length is a
  // weak signal and a long FNDDS name is often the right answer.
  score -= Math.min(2, food.description.length / 60)

  return score
}

export function rankFoods(foods: readonly Food[], query: string, limit: number): Food[] {
  return [...foods]
    .map((food) => ({ food, score: scoreFood(food, query) }))
    .sort((a, b) => b.score - a.score || a.food.description.localeCompare(b.food.description))
    .slice(0, limit)
    .map((entry) => entry.food)
}

/** Every term must appear somewhere, in any order — a phrase search would miss
 *  "Turkey sandwich on wheat" for the query "wheat turkey". */
export function matchesQuery(food: Food, terms: readonly string[]): boolean {
  const haystack = `${food.description} ${food.brand ?? ''}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function isShouting(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length < 6) return false
  return letters === letters.toUpperCase()
}
