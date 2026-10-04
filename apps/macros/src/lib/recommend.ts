import { DAY_MS, dayNoon } from '@tracker-engine/core'
import {
  CUISINES,
  type CuisineKey,
  type Nutrients,
  type Recipe,
  type RecipeUsage,
} from '@/domain/types'
import { mgToGrams, perServing, proteinPer100Kcal, scale } from '@/lib/nutrition'

/**
 * What to cook.
 *
 * A different question from `suggestFoods`, which answers "what fits in the 400 kcal I have left
 * tonight". Deciding what to cook is a decision about a *shop and an evening*, so it weighs things
 * that have nothing to do with the current day's remainder: whether you actually like the dish,
 * whether you've had it twice this week already, and whether every meal lately has been the same
 * cuisine.
 *
 * Still arithmetic rather than a model call, for the same reason: a model would invent recipes the
 * user doesn't have, and the only recipes worth recommending are the ones they can cook tonight.
 */

interface RecipeRecommendation {
  recipe: Recipe
  /** Servings that fit the remaining calories, rounded to a half. At least 0.5. */
  servings: number
  /** What `servings` of it comes to, so the caller never re-derives it. */
  nutrients: Nutrients
  score: number
  /** The single strongest reason, in the user's own numbers. */
  why: string
}

interface RecommendInputs {
  /** Calories left today, or null when there's no target — ranking then ignores fit entirely. */
  remainingKcal: number | null
  /** Protein still owed today, in mg. Drives the protein weighting. */
  remainingProteinMg: number
  recipes: readonly Recipe[]
  usage: ReadonlyMap<string, RecipeUsage>
  /** Cuisines of what's been eaten recently, most recent first. Drives the variety penalty. */
  recentCuisines: readonly (CuisineKey | null)[]
  /** Today, as `yyyy-MM-dd`, for the recency arithmetic. */
  today: string
  cuisine?: CuisineKey | null
}

/** A dish eaten within this many days is not what anyone means by "what should I cook". */
const REPEAT_DAYS = 3
/** Beyond here, "recently" stops meaning anything and the penalty is gone. */
const STALE_DAYS = 21
/** How many of the last meals the variety check looks at. */
const VARIETY_WINDOW = 6
/** g of protein per 100 kcal at which a dish counts as protein-dense — chicken breast is ~19. */
const PROTEIN_DENSE = 12
/** Recipes with no cuisine still compete for variety with each other, under one shared key. */
const UNCATEGORISED = '—'

export function recommendRecipes(
  inputs: RecommendInputs,
  limit = 5,
): RecipeRecommendation[] {
  const { remainingKcal, remainingProteinMg, recipes, usage, today } = inputs
  const proteinShort = remainingProteinMg > 0

  const cuisineLoad = countCuisines(inputs.recentCuisines.slice(0, VARIETY_WINDOW))
  const mostCooked = Math.max(1, ...[...usage.values()].map((row) => row.timesCooked))

  const scored = recipes
    .filter((recipe) => inputs.cuisine == null || recipe.cuisine === inputs.cuisine)
    .map((recipe) => {
      const each = perServing(recipe)
      if (each.kcal <= 0) return null

      const servings = servingsThatFit(each.kcal, remainingKcal)
      const total = scale(each, servings)
      const row = usage.get(recipe.id)
      const times = row?.timesCooked ?? 0
      const sinceDays = row?.lastCookedDay ? daysBetween(row.lastCookedDay, today) : null

      // Five independent signals, each normalised to 0–1 so the weights below read as "how much
      // does this matter" rather than as units nobody can compare.
      const fit = remainingKcal === null ? 0.5 : fitScore(total.kcal, remainingKcal)
      const protein = proteinShort ? Math.min(1, proteinPer100Kcal(each) / PROTEIN_DENSE) : 0.5
      const favourite = times / mostCooked
      const freshness = freshnessScore(sinceDays)
      const variety = 1 - (cuisineLoad.get(recipe.cuisine ?? UNCATEGORISED) ?? 0)

      const score =
        // Fit is worth nothing without a target, and the weight has to go somewhere real rather
        // than quietly inflating every recipe's score by the same amount.
        fit * (remainingKcal === null ? 0 : 0.3) +
        protein * (proteinShort ? 0.25 : 0.1) +
        favourite * 0.2 +
        freshness * 0.25 +
        variety * 0.15

      return {
        recipe,
        servings,
        nutrients: total,
        score,
        why: reason({ each, total, servings, remainingKcal, proteinShort, times, sinceDays }),
      }
    })
    .filter((row): row is RecipeRecommendation => row !== null)

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Servings, in halves, rounded *down*.
 *
 * Halves because "1.37 servings of chilli" is not an instruction anyone can follow — the point of a
 * recipe's yield is that you eat portions of it. Down rather than to nearest because this is a
 * budget: 1.25 servings' worth of room should propose one, not one and a half, and a suggestion
 * that quietly overshoots the remaining calories is worse than one that leaves a little.
 *
 * Never below a half. If a single serving overshoots the remainder, that's for the recommendation
 * to say plainly, not to hide by proposing a fifth of a bowl.
 */
export function servingsThatFit(kcalPerServing: number, remainingKcal: number | null): number {
  if (remainingKcal === null || kcalPerServing <= 0) return 1
  return Math.max(0.5, Math.floor((remainingKcal / kcalPerServing) * 2) / 2)
}

/** 1 when the portion lands exactly on the remainder, falling off either side of it. */
function fitScore(kcal: number, remainingKcal: number): number {
  if (remainingKcal <= 0) return 0
  return Math.max(0, 1 - Math.abs(kcal - remainingKcal) / remainingKcal)
}

/** 0 for something eaten today, climbing to 1 by three weeks out. Never cooked scores 1. */
function freshnessScore(sinceDays: number | null): number {
  if (sinceDays === null) return 1
  if (sinceDays <= REPEAT_DAYS) return sinceDays / (REPEAT_DAYS * 4)
  return Math.min(1, sinceDays / STALE_DAYS)
}

/** Share of the recent window each cuisine occupies, so a repeated one is penalised in proportion. */
function countCuisines(recent: readonly (CuisineKey | null)[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const cuisine of recent) {
    const key = cuisine ?? UNCATEGORISED
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const total = Math.max(1, recent.length)
  return new Map([...counts].map(([key, count]) => [key, count / total]))
}

/** Whole days between two `yyyy-MM-dd` keys. Midday, so no DST shift can move the count. */
function daysBetween(from: string, to: string): number {
  const ms = dayNoon(to) - dayNoon(from)
  return Math.max(0, Math.round(ms / DAY_MS))
}

/**
 * The strongest single reason, not all of them.
 *
 * Four half-reasons on one line is noise at the size this renders, and a recommendation the user
 * doesn't believe is one they won't act on — so the line names whichever signal actually put this
 * recipe at the top.
 */
function reason(args: {
  each: Nutrients
  total: Nutrients
  servings: number
  remainingKcal: number | null
  proteinShort: boolean
  times: number
  sinceDays: number | null
}): string {
  const { each, total, servings, remainingKcal, proteinShort, times, sinceDays } = args
  const portion = servings === 1 ? '' : `${servings} servings · `

  if (proteinShort && proteinPer100Kcal(each) >= 8) {
    return `${portion}${Math.round(mgToGrams(total.proteinMg))} g protein for ${total.kcal} kcal`
  }
  if (remainingKcal !== null && Math.abs(total.kcal - remainingKcal) <= remainingKcal * 0.15) {
    return `${portion}${total.kcal} kcal, near enough what's left`
  }
  if (sinceDays === null) return `${portion}saved but never cooked`
  if (sinceDays >= 14) return `${portion}not cooked in ${sinceDays} days`
  if (times >= 3) return `${portion}cooked ${times} times — one of your regulars`
  return `${portion}${total.kcal} kcal`
}

/** The cuisines actually present among a user's recipes, in the canonical order. */
export function cuisinesPresent(recipes: readonly Recipe[]): CuisineKey[] {
  const present = new Set(recipes.map((recipe) => recipe.cuisine).filter(isCuisine))
  return CUISINES.filter((key) => present.has(key))
}

const isCuisine = (value: CuisineKey | null): value is CuisineKey => value !== null
