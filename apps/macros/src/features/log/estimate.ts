import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { nutrientsFor, sum } from '@/lib/nutrition'
import { matchesQuery, queryTerms } from '@/lib/foodSearch'
import { EMPTY_NUTRIENTS, type Food, type Nutrients } from '@/domain/types'

/**
 * Turning "turkey sandwich" into weighed, matched components.
 *
 * The model contributes names and grams; every nutrient here comes from a matched food row. A
 * bad guess therefore shows up as a wrong *ingredient* the user can fix, not as a plausible
 * calorie count with no source — which is the difference between an estimate and a fabrication.
 */

export interface EstimatedItem {
  id: string
  /** What the model called it, kept even when matching fails so the row stays meaningful. */
  query: string
  grams: number
  confidence: 'high' | 'medium' | 'low'
  /** null when nothing in the database matched; that row contributes nothing to the totals. */
  food: Food | null
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
}

export interface MealEstimate {
  items: EstimatedItem[]
  assumptions: string
  nutrients: Nutrients
}

export class EstimateUnavailable extends Error {}

/**
 * When the model will be worth asking again, shared across every path that calls it.
 *
 * Module-level rather than per-component because the limit is per *account*, not per screen: the
 * free tier allows 20 requests a day for this model, so a describe, a photo and a nineteen-line
 * recipe import are all drawing on the same tiny budget. Without this, each screen would
 * independently spend a request discovering the same wall.
 */
let unavailableUntil = 0
let lastReason = ''

/** Named so `npm run lint` doesn't read a seconds-to-milliseconds multiply as a mg conversion. */
const SECOND_MS = 1_000

/** Seconds until the model is worth asking again, or 0. Drives the countdown in the UI. */
export function modelCooldownSeconds(): number {
  return Math.max(0, Math.ceil((unavailableUntil - Date.now()) / SECOND_MS))
}

/**
 * Turns a quota response into the sentence a person can act on.
 *
 * The version this replaces said "the model is busy right now — give it a few seconds and try
 * again" for everything, including a daily cap. Waiting a few seconds then changes nothing, which
 * from outside is indistinguishable from the app being broken.
 */
function quotaMessage(body: { reason?: string; quota?: string | null; kind?: string }): string {
  const seconds = modelCooldownSeconds()
  const wait =
    seconds > 90
      ? `Try again in about ${Math.ceil(seconds / 60)} minutes.`
      : seconds > 0
        ? `Try again in ${seconds} seconds.`
        : 'Try again shortly.'

  if (body.kind === 'quota') {
    const limit = /limit (\d+)/.exec(body.quota ?? '')?.[1]
    return (
      `The AI's free daily allowance is used up${limit ? ` — ${limit} requests a day` : ''}. ` +
      `${wait} Everything else works: search for the foods, or use Quick add.`
    )
  }
  return `The model is overloaded, not confused. ${wait}`
}

interface RawItem {
  query?: unknown
  grams?: unknown
  confidence?: unknown
}

export async function estimateMeal(description: string): Promise<MealEstimate> {
  return runEstimate({ mode: 'estimate', description })
}

/**
 * The same breakdown, from a photo.
 *
 * Identical contract on purpose: the model names foods and weights, the client matches and does
 * every calculation. A photo is a *weaker* signal than a sentence — it cannot show the oil a dish
 * was cooked in — so the result arrives as an editable draft with its assumptions stated, exactly
 * like a described meal, and never as a number to accept.
 */
export async function estimatePhoto(
  base64: string,
  mimeType: string,
  note = '',
): Promise<MealEstimate> {
  return runEstimate({ mode: 'photo', image: base64, mimeType, description: note })
}

/**
 * Recipe ingredient lines, at the amounts the recipe states.
 *
 * A separate mode from `estimateMeal` because the rules are opposite: a described meal needs
 * ordinary portions guessed for it, while a recipe already says "1/2 pound" and guessing a serving
 * size instead would quietly divide the dish.
 */
export async function estimateIngredients(lines: readonly string[]): Promise<MealEstimate> {
  return runEstimate({ mode: 'ingredients', lines })
}

async function runEstimate(body: Record<string, unknown>): Promise<MealEstimate> {
  const client = getSupabase()
  if (!client) {
    throw new EstimateUnavailable(
      'This needs a connection. Search for the foods instead — USDA has a lot of whole dishes.',
    )
  }

  // Don't spend a request on a wall we already know about. The allowance is per account, so a
  // second attempt from a different screen would fail for exactly the same reason.
  if (Date.now() < unavailableUntil) throw new EstimateUnavailable(lastReason)

  // Preferences go along: "a sandwich" means something different to someone who wrote down
  // "vegetarian", and guessing turkey would be worse than asking.
  const { dietNotes } = await repo.getProfile()
  const { data, error } = await client.functions.invoke<{
    items?: RawItem[]
    assumptions?: string
    error?: string
    busy?: boolean
    kind?: 'quota' | 'overloaded'
    reason?: string
    quota?: string | null
    retryAfterSeconds?: number
  }>('coach', { body: { ...body, dietNotes } })

  // A quota wall, an overloaded model and an unreadable meal are three different problems with
  // three different answers. Reporting them all as "couldn't work that out" made a spent
  // allowance look like a failure to understand a perfectly clear meal.
  if (data?.busy) {
    unavailableUntil = Date.now() + Math.max(5, data.retryAfterSeconds ?? 30) * SECOND_MS
    lastReason = quotaMessage(data)
    throw new EstimateUnavailable(lastReason)
  }
  if (error || !data || data.error || !Array.isArray(data.items)) {
    throw new EstimateUnavailable(
      "Couldn't work that out just now. Try describing it in words, or search for the foods.",
    )
  }

  const items = await Promise.all(data.items.map(toItem))
  return { items, assumptions: data.assumptions ?? '', nutrients: totalOf(items) }
}

async function toItem(raw: RawItem, index: number): Promise<EstimatedItem> {
  const query = String(raw.query ?? '').trim()
  const grams = Number(raw.grams)
  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low'

  const food = query ? await bestMatch(query) : null
  return {
    id: `est-${index}`,
    query: query || 'Unknown item',
    grams: Number.isFinite(grams) && grams > 0 ? Math.round(grams) : 0,
    confidence,
    food,
    matchedBy: food === null ? 'unmatched' : matchQuality(food, query),
  }
}

/** Local first, then remote once — a described meal shouldn't cost one API call per ingredient
 *  if the ingredients are already cached. */
async function bestMatch(query: string): Promise<Food | null> {
  const local = await repo.searchFoods(query, 1)
  if (local[0]) return local[0]

  // Generic sources only: these are ingredients, and Open Food Facts' packaged rows are both the
  // wrong answer for "cooked spaghetti" and the slowest part of breaking down a six-item meal.
  await searchRemote(query, { branded: false })
  return (await repo.searchFoods(query, 1))[0] ?? null
}

function matchQuality(food: Food, query: string): 'exact' | 'fuzzy' {
  return matchesQuery(food, queryTerms(query)) ? 'exact' : 'fuzzy'
}

export function totalOf(items: readonly EstimatedItem[]): Nutrients {
  const parts = items
    .filter((item) => item.food !== null && item.grams > 0)
    .map((item) => nutrientsFor(item.food as Food, item.grams))
  return parts.length === 0 ? { ...EMPTY_NUTRIENTS } : sum(parts)
}
