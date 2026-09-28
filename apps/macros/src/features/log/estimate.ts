import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import { matchIngredient } from '@/data/matchFood'
import { nutrientsFor, sum } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type Food, type Nutrients } from '@/domain/types'

/**
 * Turning "turkey sandwich" into weighed, matched components — or "Costco chicken bake" into one
 * product with its own panel.
 *
 * For components the model contributes names and grams only; every nutrient comes from a matched
 * food row, so a bad guess shows up as a wrong *ingredient* the user can fix rather than a plausible
 * calorie count with no source. For a named product the panel is the source, it arrives as a
 * `FoodDraft` for the user to check, and nothing is logged until they save it as a food of theirs.
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
  /**
   * True while this row is still being looked up.
   *
   * The whole reason the two phases are separate. A six-item meal meant one model request *and then*
   * up to six food-database round trips before anything appeared, all behind a single
   * "Working it out…" — thirty seconds of a screen that might equally have been broken. Now the
   * model's reading appears immediately and each row resolves in view.
   */
  isMatching: boolean
}

export interface FoodDraft {
  name: string
  brand: string
  servingGrams: number
  servingLabel: string
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number | null
  sodiumMg: number | null
  note: string
}

export interface MealEstimate {
  items: EstimatedItem[]
  assumptions: string
  nutrients: Nutrients
  /**
   * What the user called the whole thing — "3 steak tacos".
   *
   * Carried through so the log can keep one line under that name with the matched foods beneath it.
   * Without it the diary held six USDA rows and nothing the person recognised as their lunch, and
   * "I had another one" had nothing to tap. See `LogEntry.dishId`.
   */
  label: string
  product: FoodDraft | null
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
function quotaMessage(body: { reason?: string; quota?: string | null; kind?: unknown }): string {
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

interface RawProduct {
  name?: unknown
  brand?: unknown
  servingLabel?: unknown
  servingGrams?: unknown
  kcal?: unknown
  proteinG?: unknown
  carbsG?: unknown
  fatG?: unknown
  fiberG?: unknown
  sodiumMg?: unknown
  confidence?: unknown
  source?: unknown
}

export interface RawEstimate {
  kind?: unknown
  items?: RawItem[]
  item?: RawProduct | null
  assumptions?: unknown
}

const TRUST: Record<'high' | 'medium' | 'low', string> = {
  high: 'check it against the label',
  medium: 'reconstructed, not read off a label — check it',
  low: 'a rough guess from similar items — check it',
}

export function readEstimate(data: RawEstimate, label: string): MealEstimate {
  const product = data.kind === 'item' ? toProduct(data.item ?? null) : null
  const items = product ? [] : (data.items ?? []).map(toItem)
  return {
    items,
    assumptions: typeof data.assumptions === 'string' ? data.assumptions : '',
    nutrients: totalOf(items),
    label: product ? product.name : label,
    product,
  }
}

function toProduct(raw: RawProduct | null): FoodDraft | null {
  if (!raw) return null
  const name = String(raw.name ?? '').trim()
  const kcal = positive(raw.kcal)
  const servingGrams = positive(raw.servingGrams)
  if (!name || kcal === 0 || servingGrams === 0) return null

  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low'
  const source = String(raw.source ?? '').trim()

  return {
    name,
    brand: String(raw.brand ?? '').trim(),
    servingGrams: Math.round(servingGrams),
    servingLabel: String(raw.servingLabel ?? '').trim() || '1 serving',
    kcal: Math.round(kcal),
    proteinG: round1(raw.proteinG),
    carbsG: round1(raw.carbsG),
    fatG: round1(raw.fatG),
    fiberG: raw.fiberG === undefined || raw.fiberG === null ? null : round1(raw.fiberG),
    sodiumMg: raw.sodiumMg === undefined || raw.sodiumMg === null ? null : Math.round(positive(raw.sodiumMg)),
    note: [source, TRUST[confidence]].filter(Boolean).join(' · '),
  }
}

function positive(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

const round1 = (value: unknown): number => Math.round(positive(value) * 10) / 10

/**
 * Phase one: what the model read, with nothing looked up yet.
 *
 * Returns the moment the model answers, so the draft can be on screen while the database work
 * happens. `extra` is appended to the description — the refine path, where the user says "zucchini,
 * not plain" after seeing a wrong answer.
 */
export async function describeMeal(description: string, extra = ''): Promise<MealEstimate> {
  const text = extra.trim() ? `${description.trim()} (${extra.trim()})` : description.trim()
  return runDescribe({ mode: 'estimate', description: text }, description.trim())
}

/** Both phases, for callers that have nothing to show in between. Components only. */
export async function estimateMeal(description: string): Promise<MealEstimate> {
  const draft = await runDescribe(
    { mode: 'estimate', description: description.trim(), components: true },
    description.trim(),
  )
  return matchDraft(draft.product === null ? draft : asComponent(draft, draft.product))
}

function asComponent(draft: MealEstimate, product: FoodDraft): MealEstimate {
  const item = toItem(
    { query: `${product.brand} ${product.name}`.trim(), grams: product.servingGrams },
    0,
  )
  return { ...draft, items: [item], product: null }
}

/**
 * The same breakdown, from a photo.
 *
 * Identical contract on purpose: the model names foods and weights, the client matches and does
 * every calculation. A photo is a *weaker* signal than a sentence — it cannot show the oil a dish
 * was cooked in — so the result arrives as an editable draft with its assumptions stated, exactly
 * like a described meal, and never as a number to accept.
 */
export async function describePhoto(
  base64: string,
  mimeType: string,
  note = '',
): Promise<MealEstimate> {
  return runDescribe({ mode: 'photo', image: base64, mimeType, description: note }, note.trim())
}

/**
 * Recipe ingredient lines, at the amounts the recipe states.
 *
 * A separate mode from `estimateMeal` because the rules are opposite: a described meal needs
 * ordinary portions guessed for it, while a recipe already says "1/2 pound" and guessing a serving
 * size instead would quietly divide the dish.
 */
export async function estimateIngredients(lines: readonly string[]): Promise<MealEstimate> {
  return matchDraft(await runDescribe({ mode: 'ingredients', lines }, ''))
}

/** Whether the browser believes it is offline. Absent in tests and in Node; absence is not offline. */
const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false

async function runDescribe(body: Record<string, unknown>, label: string): Promise<MealEstimate> {
  const client = getSupabase()
  /**
   * Two different problems, two different sentences.
   *
   * The one this replaces — "This needs a connection. Search for the foods instead" — was wrong in
   * both halves every time it fired, because it fires when the app was *built* with no backend keys.
   * That isn't a connection problem, nothing about waiting or reconnecting fixes it, and the food
   * search it recommends instead is equally unavailable in that state: the database search goes
   * through the same function. So it told someone with a perfectly good connection that their
   * connection was the fault, and sent them to a second dead end.
   */
  if (!client) {
    throw new EstimateUnavailable(
      'This copy of the app was built without an AI connection. Quick add and your own foods still work.',
    )
  }
  if (isOffline()) {
    throw new EstimateUnavailable(
      "You're offline. Anything already saved still logs — this one needs the network.",
    )
  }

  // Don't spend a request on a wall we already know about. The allowance is per account, so a
  // second attempt from a different screen would fail for exactly the same reason.
  if (Date.now() < unavailableUntil) throw new EstimateUnavailable(lastReason)

  // Preferences go along: "a sandwich" means something different to someone who wrote down
  // "vegetarian", and guessing turkey would be worse than asking.
  const { dietNotes } = await repo.getProfile()
  const { data, error } = await client.functions.invoke<
    RawEstimate & {
      error?: string
      busy?: boolean
      reason?: string
      quota?: string | null
      retryAfterSeconds?: number
    }
  >('coach', { body: { ...body, dietNotes } })

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
      isOffline()
        ? "The connection dropped part-way. Nothing was logged — try again when you're back on."
        : "Couldn't work that out just now. Try describing it in words, or search for the foods.",
    )
  }

  return readEstimate(data, label)
}

function toItem(raw: RawItem, index: number): EstimatedItem {
  const query = String(raw.query ?? '').trim()
  const grams = Number(raw.grams)
  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low'

  return {
    id: `est-${index}`,
    query: query || 'Unknown item',
    grams: Number.isFinite(grams) && grams > 0 ? Math.round(grams) : 0,
    confidence,
    food: null,
    matchedBy: 'unmatched',
    isMatching: query.length > 0,
  }
}

/**
 * Phase two: a food row for every name, reported as each one lands.
 *
 * Identical queries share one lookup — "2 tbsp olive oil" twice in a recipe is one round trip, and a
 * described meal repeats ingredients more often than you would think.
 */
export async function matchDraft(
  draft: MealEstimate,
  onItem?: (item: EstimatedItem) => void,
): Promise<MealEstimate> {
  const inFlight = new Map<string, Promise<Awaited<ReturnType<typeof matchIngredient>>>>()
  const lookup = (query: string) => {
    const existing = inFlight.get(query)
    if (existing) return existing
    const started = matchIngredient(query)
    inFlight.set(query, started)
    return started
  }

  const items = await Promise.all(
    draft.items.map(async (item): Promise<EstimatedItem> => {
      if (!item.isMatching) return item
      const matched = await lookup(item.query)
      const resolved: EstimatedItem = {
        ...item,
        food: matched.food,
        matchedBy: matched.matchedBy,
        isMatching: false,
      }
      onItem?.(resolved)
      return resolved
    }),
  )
  return { ...draft, items, nutrients: totalOf(items) }
}

export function totalOf(items: readonly EstimatedItem[]): Nutrients {
  const parts = items
    .filter((item) => item.food !== null && item.grams > 0)
    .map((item) => nutrientsFor(item.food as Food, item.grams))
  return parts.length === 0 ? { ...EMPTY_NUTRIENTS } : sum(parts)
}
