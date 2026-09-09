/**
 * Reading a recipe's ingredient line, without a model.
 *
 * "1/2 pound lean ground beef" is not a hard parsing problem — it is a quantity, a unit and a food,
 * written the same way by every recipe on the internet. Sending it to a language model made the most
 * reliable step in the import depend on the least reliable one: a daily quota, a 45-second wait, and
 * a 503 that discarded the lot. This does it locally, instantly, and the same way every time.
 *
 * The model is still worth having for the cases this genuinely can't do — "a big bowl of chilli"
 * has no quantity to read — but it is now the fallback, not the path.
 *
 * Deliberately does **not** guess grams from a volume on its own. A cup of flour and a cup of oil
 * differ by nearly a factor of two, so volumes come out as a unit and a count, and the gram figure
 * is resolved after a food is matched, against that food's own USDA portions. See
 * `lib/resolveAmount.ts`.
 */

export type AmountUnit =
  /** Already a mass: convertible with no food-specific knowledge. */
  | 'g'
  | 'kg'
  | 'oz'
  | 'lb'
  /** A volume: needs the matched food's density or a "1 cup" portion. */
  | 'ml'
  | 'l'
  | 'tsp'
  | 'tbsp'
  | 'cup'
  | 'fl-oz'
  | 'pint'
  | 'quart'
  /** A countable thing: needs the food's "1 medium" / "1 clove" / "1 slice" portion. */
  | 'piece'
  | 'clove'
  | 'slice'
  | 'can'
  | 'package'
  | 'bunch'
  | 'sprig'
  | 'stalk'
  | 'head'
  | 'pinch'

export interface ParsedIngredient {
  /** The line as written, kept so a wrong parse is visible next to its source. */
  raw: string
  /** The food, stripped of quantity, unit, prep notes and parentheses. */
  name: string
  /** null when the line states no usable amount ("salt and pepper to taste"). */
  quantity: number | null
  unit: AmountUnit | null
  /** Grams, when the unit is already a mass. Otherwise resolved after matching a food. */
  grams: number | null
  /** What was thrown away — "chopped", "divided", "to taste" — so the UI can show it if useful. */
  note: string
  /** True when the line is a seasoning or garnish with no stated amount; safe to skip. */
  isToTaste: boolean
}

const GRAMS_PER: Record<string, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 }

/** Millilitres, for the volumes that have a fixed one. US customary, which is what recipes use. */
export const ML_PER: Partial<Record<AmountUnit, number>> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  cup: 236.588,
  'fl-oz': 29.5735,
  pint: 473.176,
  quart: 946.353,
}

/**
 * Unit spellings, longest first so "tablespoon" isn't read as "tbsp" plus "espoon".
 *
 * Includes the abbreviations with and without full stops, and the plurals, because recipe sites use
 * all of them and a miss here means a whole ingredient silently loses its amount.
 */
const UNIT_WORDS: [pattern: string, unit: AmountUnit][] = [
  ['kilograms', 'kg'], ['kilogram', 'kg'], ['kgs', 'kg'], ['kg', 'kg'],
  ['grams', 'g'], ['gram', 'g'], ['gr', 'g'], ['g', 'g'],
  ['pounds', 'lb'], ['pound', 'lb'], ['lbs', 'lb'], ['lb', 'lb'],
  ['ounces', 'oz'], ['ounce', 'oz'], ['ozs', 'oz'], ['oz', 'oz'],
  ['fluid ounces', 'fl-oz'], ['fluid ounce', 'fl-oz'], ['fl oz', 'fl-oz'], ['floz', 'fl-oz'],
  ['millilitres', 'ml'], ['milliliters', 'ml'], ['millilitre', 'ml'], ['milliliter', 'ml'], ['ml', 'ml'],
  ['litres', 'l'], ['liters', 'l'], ['litre', 'l'], ['liter', 'l'], ['l', 'l'],
  ['tablespoons', 'tbsp'], ['tablespoon', 'tbsp'], ['tbsps', 'tbsp'], ['tbsp', 'tbsp'], ['tbs', 'tbsp'], ['tb', 'tbsp'],
  ['teaspoons', 'tsp'], ['teaspoon', 'tsp'], ['tsps', 'tsp'], ['tsp', 'tsp'], ['tspn', 'tsp'],
  ['cups', 'cup'], ['cup', 'cup'], ['c', 'cup'],
  ['pints', 'pint'], ['pint', 'pint'], ['pt', 'pint'],
  ['quarts', 'quart'], ['quart', 'quart'], ['qt', 'quart'],
  ['cloves', 'clove'], ['clove', 'clove'],
  ['slices', 'slice'], ['slice', 'slice'],
  ['cans', 'can'], ['can', 'can'], ['tins', 'can'], ['tin', 'can'], ['jars', 'can'], ['jar', 'can'],
  ['packages', 'package'], ['package', 'package'], ['packets', 'package'], ['packet', 'package'],
  ['bunches', 'bunch'], ['bunch', 'bunch'],
  ['sprigs', 'sprig'], ['sprig', 'sprig'],
  ['stalks', 'stalk'], ['stalk', 'stalk'], ['ribs', 'stalk'], ['rib', 'stalk'],
  ['heads', 'head'], ['head', 'head'],
  ['pinches', 'pinch'], ['pinch', 'pinch'],
]

/** Vulgar fractions, which recipe sites emit as single characters. */
const VULGAR: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

/**
 * Words describing what was done to the food, not what it is.
 *
 * Stripped because they wreck the database match: "1 yellow onion, chopped" finds nothing searching
 * for "yellow onion chopped", and finds the onion searching for "yellow onion".
 */
const PREP_WORDS = [
  'chopped', 'finely chopped', 'roughly chopped', 'minced', 'diced', 'sliced', 'thinly sliced',
  'shredded', 'grated', 'freshly grated', 'crumbled', 'cubed', 'julienned', 'halved', 'quartered',
  'peeled', 'seeded', 'cored', 'trimmed', 'rinsed', 'drained', 'divided', 'softened', 'melted',
  'room temperature', 'at room temperature', 'packed', 'lightly packed', 'firmly packed', 'sifted',
  'beaten', 'lightly beaten', 'whisked', 'toasted', 'roasted', 'cooked', 'uncooked', 'raw',
  'plus more', 'plus more for serving', 'for serving', 'for garnish', 'for drizzling',
  'for brushing', 'to serve', 'optional', 'or more', 'or to taste', 'to taste', 'if desired',
  'broken into pieces', 'cut into pieces', 'cut into chunks', 'large', 'small', 'medium',
]

/** A line with one of these and no weight is a seasoning, and inventing a gram figure for it is
 *  worse than leaving it out. */
const TO_TASTE = /\b(to taste|for (serving|garnish|drizzling|brushing)|as needed|optional)\b/i

export function parseIngredientLine(raw: string): ParsedIngredient {
  const line = raw.replace(/\s+/g, ' ').trim()
  const isToTaste = TO_TASTE.test(line)

  // A parenthetical mass or volume is the *real* amount: "1 (28 oz) can crushed tomatoes" is 28 oz,
  // and the "1" counts cans. Checked first, because it beats the leading count every time.
  //
  // Innermost bracket, and the first one that actually parses: "(, chopped (or 2 tsp dried))" has
  // two, and only the inner one holds a number — but it describes an *alternative*, so a leading
  // comma or an "or" disqualifies it. Otherwise parsley measured in teaspoons of dried parsley.
  const paren = parentheticalAmount(line)
  const lead = matchAmount(stripParens(line))

  const chosen = paren?.unit && paren.unit in GRAMS_PER ? paren : (lead ?? paren)
  const multiple = paren && chosen === paren && lead ? (lead.quantity ?? 1) : 1

  const quantity = chosen ? (chosen.quantity ?? 1) * multiple : null
  const unit = chosen?.unit ?? null
  const grams =
    quantity !== null && unit !== null && unit in GRAMS_PER
      ? Math.round(quantity * GRAMS_PER[unit]!)
      : null

  const { name, note } = cleanName(line)

  return { raw, name, quantity, unit, grams, note, isToTaste }
}

interface Amount {
  quantity: number | null
  unit: AmountUnit | null
}

/**
 * The amount stated inside brackets, if one of them states a size rather than an alternative.
 *
 * "(28 oz)" is the size of the can. "(or 2 tsp dried)" and "(, chopped)" are asides about something
 * else, and reading the second as the amount measured fresh parsley in teaspoons of dried.
 */
function parentheticalAmount(line: string): Amount | null {
  for (const match of line.matchAll(/\(([^()]*)\)/g)) {
    const inner = (match[1] ?? '').trim()
    if (inner === '' || /^[,;]/.test(inner) || /\bor\b/i.test(inner)) continue
    const amount = matchAmount(inner)
    if (amount?.unit && amount.unit in GRAMS_PER) return amount
    if (amount?.unit && ML_PER[amount.unit] !== undefined) return amount
  }
  return null
}

/** A leading number and an optional unit: "1 1/2 cups", "227g", "½ tsp", "2-3 tbsp". */
function matchAmount(text: string): Amount | null {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return null

  const number = matchQuantity(trimmed)
  if (number === null) return null

  const rest = trimmed.slice(number.length).trim()
  for (const [word, unit] of UNIT_WORDS) {
    // Word-boundary, so "1 g" is grams and "1 garlic clove" is not.
    if (rest === word || rest.startsWith(`${word} `) || rest.startsWith(`${word}.`)) {
      return { quantity: number.value, unit }
    }
  }
  // A bare number with no unit counts things: "1 onion", "9 lasagna noodles".
  return { quantity: number.value, unit: rest.length > 0 ? 'piece' : null }
}

/**
 * The numeric part: mixed numbers, fractions, vulgar fractions, ranges and decimals.
 *
 * Ordered alternatives rather than one regex with optional groups, because the greedy reading is
 * always wrong here: a single pattern starting `^(\d+)` matches the "1" of "1/2" and leaves "/2
 * teaspoon" behind, so half a teaspoon of oregano became one *of something unparseable*. Longest
 * interpretation first, checked explicitly.
 */
const VULGAR_CLASS = Object.keys(VULGAR).join('')

const QUANTITY_PATTERNS: [RegExp, (m: RegExpMatchArray) => number][] = [
  // "1 1/2"
  [/^(\d+)\s+(\d+)\s*\/\s*(\d+)/, (m) => Number(m[1]) + Number(m[2]) / Number(m[3])],
  // "1½"
  [new RegExp(`^(\\d+)\\s*([${VULGAR_CLASS}])`), (m) => Number(m[1]) + VULGAR[m[2]!]!],
  // "1/2"
  [/^(\d+)\s*\/\s*(\d+)/, (m) => Number(m[1]) / Number(m[2])],
  // "2-3": a real amount, so take the midpoint rather than dropping the line. Pretending it said
  // 2 is a smaller lie than pretending it said nothing, and 2.5 is smaller still.
  [/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/, (m) => (Number(m[1]) + Number(m[2])) / 2],
  // "1.5", "2"
  [/^(\d+(?:\.\d+)?)/, (m) => Number(m[1])],
  // "½"
  [new RegExp(`^([${VULGAR_CLASS}])`), (m) => VULGAR[m[1]!]!],
]

function matchQuantity(text: string): { value: number; length: number } | null {
  for (const [pattern, valueOf] of QUANTITY_PATTERNS) {
    const match = text.match(pattern)
    if (match) return { value: valueOf(match), length: match[0].length }
  }
  return null
}

/**
 * Removes parentheses, however deeply they nest.
 *
 * One pass of `\([^)]*\)` on "ricotta cheese ((or cottage cheese))" removes the *inner* pair and
 * leaves the outer closer behind, so the food came out as "ricotta cheese )" — which then matched
 * nothing and logged as zero. Recipe sites nest parentheses constantly ("(, chopped (or 2 tsp
 * dried))"), so this repeats until nothing changes, then sweeps up any unbalanced bracket left over.
 */
function stripParens(line: string): string {
  let text = line
  for (let pass = 0; pass < 5; pass += 1) {
    const next = text.replace(/\([^()]*\)/g, ' ')
    if (next === text) break
    text = next
  }
  return text.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The searchable food name: no quantity, no unit, no parentheses, no prep notes.
 *
 * Everything after the first comma usually *is* prep ("1 yellow onion, chopped"), but not always
 * ("chicken broth, low sodium"), so commas are kept and only known prep words are removed.
 */
function cleanName(line: string): { name: string; note: string } {
  const notes: string[] = []
  let text = line

  // Parentheses hold amounts and asides, never the food itself. Innermost first and repeatedly,
  // because a single pass over a nested pair leaves the outer bracket in the food's name.
  for (let pass = 0; pass < 5; pass += 1) {
    const next = text.replace(/\(([^()]*)\)/g, (_match, inner: string) => {
      const trimmed = inner.trim()
      if (trimmed) notes.push(trimmed)
      return ' '
    })
    if (next === text) break
    text = next
  }
  // Anything unbalanced the site left behind is punctuation, not part of the food.
  text = text.replace(/[()]/g, ' ')

  // The leading amount, however it was written.
  const lead = matchQuantity(text.trim().toLowerCase())
  if (lead) {
    text = text.trim().slice(lead.length)
    for (const [word] of UNIT_WORDS) {
      const lower = text.trim().toLowerCase()
      if (lower === word || lower.startsWith(`${word} `) || lower.startsWith(`${word}.`)) {
        text = text.trim().slice(word.length).replace(/^\./, '')
        break
      }
    }
  }

  for (const word of [...PREP_WORDS].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(^|[,;]\\s*|\\s)${escape(word)}\\b`, 'gi')
    if (pattern.test(text)) {
      notes.push(word)
      text = text.replace(pattern, ' ')
    }
  }

  const name = text
    .replace(/\bof\b/gi, ' ')
    .replace(/[,;]+/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()

  return { name, note: [...new Set(notes)].filter(Boolean).join(', ') }
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
