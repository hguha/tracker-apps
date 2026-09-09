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

/**
 * Qualifiers that change what a food *is*, not just how it's described.
 *
 * Searching "meatballs" ranked "Meatball, meatless" first, and an estimate built from a photo of
 * beef meatballs then silently used the vegetarian row's macros. So a row carrying one of these
 * words is pushed down unless the query asked for it — a wrong answer that reads as right is worse
 * than no answer.
 */
const MEANING_CHANGING = [
  'meatless',
  'vegetarian',
  'vegan',
  'baby food',
  'infant',
  'toddler',
  'dietetic',
  'imitation',
  'substitute',
  'unprepared',
  'dry mix',
  'reduced sodium',
  'low sodium',
  'fat free',
  'nonfat',
  'sugar free',
  'unsweetened',
  'decaffeinated',
]

export function scoreFood(food: Food, query: string): number {
  const q = query.trim().toLowerCase()
  const haystack = `${food.description} ${food.brand ?? ''}`.toLowerCase()

  let score = DATA_TYPE_SCORE[(food.dataType ?? '').toLowerCase()] ?? 2

  // A row with no portions can only be logged in raw grams, which is a worse answer to any
  // query. Branded USDA rows are frequently portion-less.
  if (food.portions.length > 0) score += 3

  if (haystack.startsWith(q)) score += 4
  else if (food.description.toLowerCase().startsWith(q)) score += 3

  // USDA names a food as `head, qualifier, qualifier`: everything before the first comma is what
  // the food *is*, and the rest is how it was prepared. So an extra word in the head is a
  // different food ("Spaghetti squash, cooked" for "cooked spaghetti"), while extra words after
  // it are only detail ("Spaghetti, cooked, enriched, without added salt" — the right answer,
  // and the longer string, which is why a length penalty alone ranked the squash first).
  const terms = queryTerms(q).map(stem)
  const head = queryTerms(food.description.split(',')[0] ?? '').map(stem)
  const extraInHead = head.filter((word) => !terms.includes(word)).length
  if (head.length > 0 && extraInHead === 0) score += 3
  score -= 2 * extraInHead

  // ALL-CAPS is the signature of a branded label dump; it reads badly in a list and is
  // usually the less useful match for a generic query.
  if (isShouting(food.description)) score -= 2

  // Prefer the more specific of two equally-typed matches, but only mildly — length is a
  // weak signal and a long FNDDS name is often the right answer.
  score -= Math.min(2, food.description.length / 60)

  for (const qualifier of MEANING_CHANGING) {
    if (haystack.includes(qualifier) && !q.includes(qualifier)) score -= 5
  }

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

/**
 * Crude singularisation, only enough to make "meatballs" and "meatball" the same word.
 *
 * Not a stemmer: over-stemming would merge foods that differ ("oats"/"oat" is fine, "molasses"
 * would not be), so it stops at a trailing "s" on a word long enough for that to be a plural.
 */
function stem(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function isShouting(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length < 6) return false
  return letters === letters.toUpperCase()
}
