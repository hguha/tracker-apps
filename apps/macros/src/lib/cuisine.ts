import { CUISINES, type CuisineKey } from '@/domain/types'

/**
 * Naming cuisines, and recognising them in someone else's words.
 *
 * The recognising half exists because an imported recipe's `recipeCuisine` is whatever the author
 * typed: "Italian-American", "asian", "Tex Mex", "Sichuan". Mapping that onto a closed list is what
 * makes a filter work at all — but a wrong bucket is worse than no bucket, so anything unrecognised
 * returns null and keeps its own words as a tag.
 */

export const CUISINE_LABELS: Record<CuisineKey, string> = {
  american: 'American',
  italian: 'Italian',
  mexican: 'Mexican',
  chinese: 'Chinese',
  japanese: 'Japanese',
  korean: 'Korean',
  thai: 'Thai',
  vietnamese: 'Vietnamese',
  indian: 'Indian',
  'middle-eastern': 'Middle Eastern',
  mediterranean: 'Mediterranean',
  french: 'French',
  british: 'British',
  caribbean: 'Caribbean',
  african: 'African',
}

/**
 * Words that name a cuisine, beyond the labels themselves.
 *
 * Regional names dominate here on purpose: a recipe site is far likelier to say "Sichuan" or
 * "Tuscan" than "Chinese" or "Italian", and a country's own regions are the safest possible
 * evidence — unlike ingredient words, which cross borders freely and would file every dish with
 * soy sauce as Chinese.
 */
const ALIASES: Record<string, CuisineKey> = {
  usa: 'american',
  'tex mex': 'mexican',
  texmex: 'mexican',
  southern: 'american',
  cajun: 'american',
  creole: 'american',
  bbq: 'american',
  barbecue: 'american',
  sicilian: 'italian',
  tuscan: 'italian',
  neapolitan: 'italian',
  'italian american': 'italian',
  oaxacan: 'mexican',
  sichuan: 'chinese',
  szechuan: 'chinese',
  cantonese: 'chinese',
  hunan: 'chinese',
  taiwanese: 'chinese',
  'hong kong': 'chinese',
  sushi: 'japanese',
  ramen: 'japanese',
  izakaya: 'japanese',
  'south indian': 'indian',
  'north indian': 'indian',
  punjabi: 'indian',
  bengali: 'indian',
  gujarati: 'indian',
  goan: 'indian',
  pakistani: 'indian',
  'sri lankan': 'indian',
  nepali: 'indian',
  curry: 'indian',
  lebanese: 'middle-eastern',
  turkish: 'middle-eastern',
  persian: 'middle-eastern',
  iranian: 'middle-eastern',
  israeli: 'middle-eastern',
  syrian: 'middle-eastern',
  'middle east': 'middle-eastern',
  greek: 'mediterranean',
  spanish: 'mediterranean',
  portuguese: 'mediterranean',
  moroccan: 'african',
  ethiopian: 'african',
  nigerian: 'african',
  'west african': 'african',
  'south african': 'african',
  provencal: 'french',
  parisian: 'french',
  english: 'british',
  irish: 'british',
  scottish: 'british',
  welsh: 'british',
  jamaican: 'caribbean',
  cuban: 'caribbean',
  'puerto rican': 'caribbean',
  trinidadian: 'caribbean',
  pho: 'vietnamese',
}

// Words deliberately absent: "Asian" and "European" each cover four entries on this list, so
// mapping either one anywhere is a coin flip dressed up as data. They fall through to null, and
// the user picks in one tap.

export function cuisineLabel(key: CuisineKey | null): string {
  return key === null ? 'Uncategorised' : CUISINE_LABELS[key]
}

/**
 * Reads a cuisine out of free text. The longest match wins, so "italian american" beats the bare
 * "american" that also appears in it.
 *
 * Matched on whole words, not substrings. A plain `includes` filed "Fusion" as American, because it
 * contains "us" — which is exactly the class of silent mis-categorisation a closed list is here to
 * prevent.
 */
export function parseCuisine(raw: string | null | undefined): CuisineKey | null {
  const text = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length === 0) return null

  // Every candidate that appears, longest phrase first; the first hit is the most specific.
  const candidates: [phrase: string, key: CuisineKey][] = [
    ...CUISINES.map((key): [string, CuisineKey] => [key.replace(/-/g, ' '), key]),
    ...Object.entries(ALIASES).map(([phrase, key]): [string, CuisineKey] => [phrase, key]),
  ].sort((a, b) => b[0].length - a[0].length)

  return candidates.find(([phrase]) => hasPhrase(text, phrase))?.[1] ?? null
}

/**
 * `phrase` as whole words inside `text`, both already lowercased and space-normalised.
 *
 * `\s*` between words rather than a single space, so a site writing "TexMex" is read the same as
 * one writing "Tex Mex".
 */
const hasPhrase = (text: string, phrase: string): boolean =>
  new RegExp(`\\b${phrase.replace(/ /g, '\\s*')}\\b`).test(text)
