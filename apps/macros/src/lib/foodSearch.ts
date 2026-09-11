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
  return matchesHaystack(haystackOf(food), terms)
}

/** What a food's name and brand look like to the matcher. Built once per row where it's cached. */
export const haystackOf = (food: Food): string =>
  `${food.description} ${food.brand ?? ''}`.toLowerCase()

/**
 * The same test against an already-lowercased string.
 *
 * Exists because `searchFoods` runs on every keystroke over the whole cache: rebuilding and
 * lowercasing 1,500 strings per keystroke is work the index can do once and never repeat.
 */
export function matchesHaystack(haystack: string, terms: readonly string[]): boolean {
  return terms.every((term) => haystack.includes(term))
}

/**
 * How many of the query's terms this row contains, and how specific those terms were.
 *
 * The loose counterpart to `matchesHaystack`, for when nothing matches every word. This replaced a
 * hand-written table of ingredient aliases — 55 rows of "lasagna noodles means pasta, dry" — which
 * was unmaintainable and, it turned out, mostly redundant: USDA's own search resolves "heavy
 * whipping cream", "scallions" and "Italian sausage" correctly on its own. What was actually broken
 * was re-filtering those results locally with an all-terms rule, which threw the right answer away.
 *
 * Longer terms count for more, so "noodles" outweighs "dry" and a row matching the head noun beats
 * one matching only a modifier — which is what puts "Noodles, egg, dry" above "Lasagna with meat"
 * for "lasagna noodles, dry" without anyone writing that rule down.
 */
export function overlapScore(haystack: string, terms: readonly string[]): number {
  let score = 0
  for (const term of terms) {
    if (haystack.includes(term)) score += Math.min(4, term.length)
  }
  return score
}

export function queryTerms(query: string): string[] {
  return normalizeQuery(query).split(/\s+/).filter(Boolean)
}

/**
 * How people write food names, turned into how databases store them.
 *
 * "80/20 ground beef" returned **nothing at all** — not a bad ranking, zero rows — because the
 * slash breaks USDA's search, while "ground beef 80" returns exactly the right entry ("Beef,
 * ground, 80% lean meat / 20% fat, raw"). The same shape covers "93/7", "85/15" and "2% milk".
 *
 * Applied in `queryTerms`, so the local match, the ranking and the string forwarded to USDA all see
 * the same normalisation. A search that silently returns nothing is the worst failure this app can
 * have: it looks exactly like the food not existing.
 */
export function normalizeQuery(query: string): string {
  return (
    query
      .trim()
      .toLowerCase()
      // A lean/fat ratio: keep both numbers as words, drop the slash. USDA's own text has the
      // numbers in it, so "80 20" matches where "80/20" matches nothing.
      .replace(/\b(\d{2})\s*\/\s*(\d{1,2})\b/g, '$1 $2')
      // Percent signs are punctuation to USDA's index but meaningful to a person typing "2% milk".
      .replace(/(\d)\s*%/g, '$1')
      // Any other slash or hyphen between words is a separator, not a character in a food name:
      // "half-and-half", "chicken/rice".
      .replace(/[/\\]+/g, ' ')
      // Punctuation is a separator too. Left in, a term carried its comma — so searching for
      // "noodles, dry" required the database to put its comma in the same place, and "lasagna
      // noodles, dry" could only ever match a row containing the literal string "noodles,".
      .replace(/[,;:.!?()[\]"']+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(DIALECT, (word) => DIALECT_WORDS[word] ?? word)
  )
}

/**
 * British and Japanese words for American foods.
 *
 * Spelling, not synonymy — which is why this exists and a table of ingredient aliases doesn't.
 * FoodData Central is a US database: "courgette" and "panko" return *literally nothing* from it, and
 * no amount of relevance ranking can bridge a word the index has never seen. Everything a US search
 * engine can resolve on its own is deliberately absent.
 */
const DIALECT_WORDS: Record<string, string> = {
  courgette: 'zucchini',
  courgettes: 'zucchini',
  aubergine: 'eggplant',
  aubergines: 'eggplant',
  coriander: 'cilantro',
  rocket: 'arugula',
  swede: 'rutabaga',
  beetroot: 'beets',
  prawns: 'shrimp',
  prawn: 'shrimp',
  panko: 'bread crumbs',
  mince: 'ground',
  passata: 'tomato puree',
  sultanas: 'raisins',
}

const DIALECT = new RegExp(`\\b(${Object.keys(DIALECT_WORDS).join('|')})\\b`, 'g')

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
