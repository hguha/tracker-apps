/**
 * "3 steak tacos" → three of a *steak taco*.
 *
 * Worth separating because the count and the thing are different facts with different uses: the count
 * says how much was eaten *this* time, and the thing is what's worth keeping. Saving a dish as
 * "3 steak tacos" means having one tomorrow requires either dividing by three in your head or saving a
 * second, near-identical dish; saving one taco means both 1 and 3 are a multiple away.
 *
 * Deliberately shallow. It reads a leading number and de-pluralises the head noun, and it declines
 * anything else — a mis-parse here would silently divide a meal's macros by a number nobody typed,
 * which is far worse than not offering the feature on that meal.
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  a_dozen: 12,
  dozen: 12,
}

/**
 * When the number counts a *container* or a *measure* rather than the food.
 *
 * Two rules, and the second does most of the work: **"of" means the number is not the food**. "3 bowls
 * of soup" is one soup in three bowls and "2 servings of hummus" is one hummus, so dividing either by
 * its count would be wrong. The explicit list catches the cases with no "of" — "12 oz steak".
 */
const MEASURES =
  /^(bowls?|plates?|cups?|glasses|bottles?|cans?|servings?|portions?|slices?|pieces?|handfuls?|scoops?|bags?|packs?|packets?|boxes|tubs?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|g|grams?|kg|ml|l|litres?|liters?)\b/i

const countsAContainer = (rest: string): boolean => MEASURES.test(rest) || /\bof\b/i.test(rest)

export interface ParsedQuantity {
  /** How many were eaten. Always ≥ 1. */
  count: number
  /** The singular thing, capitalised as the user wrote it: "steak taco". */
  unit: string
}

/**
 * Splits a leading count off a description, or returns null when there isn't one worth trusting.
 *
 * Null for: no leading number, a count of one (nothing to divide), a fraction, a count above a
 * plausible number of discrete items, and anything where the number counts a container or a weight.
 */
export function parseQuantity(label: string): ParsedQuantity | null {
  const text = label.trim().replace(/\s+/g, ' ')
  if (text === '') return null

  const [, digits, rest] = /^(\d+)\s+(.+)$/.exec(text) ?? []
  const [, word, wordRest] = /^([a-z]+)\s+(.+)$/i.exec(text) ?? []

  let count: number | undefined
  let remainder: string | undefined
  if (digits !== undefined) {
    count = Number(digits)
    remainder = rest
  } else if (word !== undefined && NUMBER_WORDS[word.toLowerCase()] !== undefined) {
    count = NUMBER_WORDS[word.toLowerCase()]
    remainder = wordRest
  }

  if (count === undefined || remainder === undefined) return null
  // 1 has nothing to divide; above 24 it is far more likely to be grams, millilitres or a year than
  // a number of tacos.
  if (count < 2 || count > 24) return null
  if (countsAContainer(remainder)) return null
  // "1/2" or "1.5" of something is not a count of discrete items.
  if (/^[\d/.]/.test(remainder)) return null

  const unit = singularise(remainder)
  return unit === '' ? null : { count, unit }
}

/**
 * `-ies` words whose singular ends `-ie`, not `-y`.
 *
 * There is no suffix rule that separates these from "berries → berry": both stems end in a consonant,
 * and the answer is a fact about the word. So this is a short list of the ones that turn up in food,
 * and everything else defaults to `-y`. A wrong guess is a one-tap fix, because the name is an
 * editable field wherever this is used — which is why a short list is the right amount of machinery.
 */
const IE_PLURALS = /(brownies|cookies|smoothies|veggies|pies|hoagies|tostadies)$/i

/**
 * De-pluralises the head noun and leaves everything else alone.
 *
 * Only the last word, and only the endings English actually uses this way — a stemmer would turn
 * "hummus" into "hummu" and "chips" into "chip" when the singular nobody says is the plural.
 */
function singularise(phrase: string): string {
  const words = phrase.split(' ')
  const last = words[words.length - 1]
  if (last === undefined) return phrase

  const lower = last.toLowerCase()
  // Words that are already singular despite the -s, or that nobody says in the singular.
  if (/(ss|us|is|chips|greens|oats|noodles|fries|beans|peas|grits)$/i.test(lower)) return phrase

  let singular = last
  if (IE_PLURALS.test(lower)) singular = last.slice(0, -1)
  else if (/ies$/i.test(lower) && lower.length > 4) singular = last.slice(0, -3) + 'y'
  else if (/(ch|sh|x|z|s)es$/i.test(lower)) singular = last.slice(0, -2)
  else if (/s$/i.test(lower) && lower.length > 2) singular = last.slice(0, -1)

  return [...words.slice(0, -1), singular].join(' ')
}
