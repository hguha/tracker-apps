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

async function runEstimate(body: Record<string, unknown>): Promise<MealEstimate> {
  const client = getSupabase()
  if (!client) {
    throw new EstimateUnavailable(
      'This needs a connection. Search for the foods instead — USDA has a lot of whole dishes.',
    )
  }

  // Preferences go along: "a sandwich" means something different to someone who wrote down
  // "vegetarian", and guessing turkey would be worse than asking.
  const { dietNotes } = await repo.getProfile()
  const { data, error } = await client.functions.invoke<{
    items?: RawItem[]
    assumptions?: string
    error?: string
  }>('coach', { body: { ...body, dietNotes } })

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

  await searchRemote(query)
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
