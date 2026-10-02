import {
  CORE_NUTRIENT_KEYS,
  EMPTY_NUTRIENTS,
  NUTRIENT_KEYS,
  type Food,
  type FoodPortion,
  type LogEntry,
  type MacroTargets,
  type Nutrients,
  type Recipe,
} from '@/domain/types'

/**
 * The one place nutrient arithmetic happens. Every screen, chart, target and AI caller
 * reads from here, so they cannot disagree — the same rule that stopped REPutation's coach
 * and home screen reporting different volumes. Enforced by scripts/check-architecture.mjs.
 */

const MG_PER_G = 1000

export const gramsToMg = (g: number): number => Math.round(g * MG_PER_G)
export const mgToGrams = (mg: number): number => mg / MG_PER_G

export const per100FromServing = (value: number, servingGrams: number): number =>
  (value * 100) / Math.max(1, servingGrams)

/**
 * A label's per-serving figures, on the per-100 g basis everything else scales from.
 *
 * Pass `servingGrams: 100` for figures already stated per 100 g. Optional fields stay null rather
 * than becoming zero, so "unknown" survives the conversion.
 */
export interface ServingPanel {
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number | null
  sodiumMg?: number | null
}

export function per100FromPanel(panel: ServingPanel, servingGrams: number): Nutrients {
  const per100 = (value: number) => per100FromServing(value, servingGrams)
  return {
    ...EMPTY_NUTRIENTS,
    kcal: Math.round(per100(panel.kcal)),
    proteinMg: gramsToMg(per100(panel.proteinG)),
    carbsMg: gramsToMg(per100(panel.carbsG)),
    fatMg: gramsToMg(per100(panel.fatG)),
    fiberMg:
      panel.fiberG === null || panel.fiberG === undefined ? null : gramsToMg(per100(panel.fiberG)),
    sodiumMg:
      panel.sodiumMg === null || panel.sodiumMg === undefined
        ? null
        : Math.round(per100(panel.sodiumMg)),
  }
}

/**
 * FNDDS carries condiment guidelines as portions — "Guideline amount per sandwich", "Guideline amount
 * per fl oz of beverage" — and they are first in FDC's order, which is where `isDefault` is set. So 42
 * of the seeded foods opened the amount screen on one: almond butter measured per sandwich, almond
 * milk per fluid ounce of *something else*. They are real weights and a poor thing to open on, so they
 * stay available and lose their claim to being the default.
 */
const GUIDELINE = /^guideline amount/i

export function portionFor(food: Food, portionId: string | null): FoodPortion | null {
  if (portionId) return food.portions.find((p) => p.id === portionId) ?? null
  const measures = food.portions.filter((p) => !GUIDELINE.test(p.label))
  const pool = measures.length > 0 ? measures : food.portions
  return pool.find((p) => p.isDefault) ?? pool[0] ?? null
}

/** Scales by a factor. Nullable nutrients stay null: unknown × 2 is still unknown. */
export function scale(n: Nutrients, factor: number): Nutrients {
  const out: NutrientRecord = { ...EMPTY_NUTRIENTS }
  for (const key of NUTRIENT_KEYS) {
    const value = n[key]
    out[key] = value === null ? null : Math.round(value * factor)
  }
  return out as Nutrients
}

// Nutrients with every field widened to nullable, so a fold can fill it key by key.
type NutrientRecord = Record<keyof Nutrients, number | null>

export function nutrientsFor(food: Food, grams: number): Nutrients {
  return scale(food.per100, grams / 100)
}

/**
 * Sums a list. A nullable nutrient is null unless *every* contributor reports it —
 * summing only the known rows would understate the total while looking precise.
 *
 * All-or-nothing is right for a **recipe**, which is what this is for: a dish whose paprika has no
 * fibre figure genuinely has an unknown fibre total, and there is no honest number to show.
 *
 * It is the wrong rule for a **day**, and using it there was a bug. 218 of the 1,463 seeded foods
 * have at least one missing micronutrient, so a six-ingredient dish had a ~62% chance of containing
 * one — and that single row erased that nutrient for the whole day. Logging "3 steak tacos" matched
 * an Applebee's sirloin with no fibre figure and the day reported no fibre at all. Days use
 * `sumCovered`, which reports what was measured alongside how much of the day it covers.
 */
export function sum(items: readonly Nutrients[]): Nutrients {
  if (items.length === 0) return { ...EMPTY_NUTRIENTS }
  const out: NutrientRecord = { ...EMPTY_NUTRIENTS }
  for (const key of NUTRIENT_KEYS) {
    if ((CORE_NUTRIENT_KEYS as readonly string[]).includes(key)) {
      out[key] = items.reduce((acc, item) => acc + (item[key] ?? 0), 0)
      continue
    }
    out[key] = items.every((item) => item[key] !== null)
      ? items.reduce((acc, item) => acc + (item[key] ?? 0), 0)
      : null
  }
  return out as Nutrients
}

/** Every nutrient that can be missing — the ones a food database may simply not record. */
export const MICRO_KEYS = NUTRIENT_KEYS.filter(
  (key) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(key),
) as Exclude<keyof Nutrients, (typeof CORE_NUTRIENT_KEYS)[number]>[]

export type MicroKey = (typeof MICRO_KEYS)[number]

export interface CoveredNutrients {
  /** Micros are the sum of what *was* reported; null only when nothing reported it at all. */
  totals: Nutrients
  /**
   * Share of the period's calories that came from foods reporting this nutrient, 0–1.
   *
   * Calories rather than rows, because a gap on a 600 kcal main course matters and a gap on a
   * 5 kcal squeeze of lime does not. This is what lets the UI say "26 g of fibre, from 91% of what
   * you ate" — a floor with its own confidence attached — instead of choosing between a wrong number
   * and no number.
   */
  coverage: Record<MicroKey, number>
}

export function sumCovered(items: readonly Nutrients[]): CoveredNutrients {
  const totals: NutrientRecord = { ...EMPTY_NUTRIENTS }
  for (const key of CORE_NUTRIENT_KEYS) {
    totals[key] = items.reduce((acc, item) => acc + item[key], 0)
  }

  // Rows with no calories still count as covered or not; they just carry no weight. A day of only
  // zero-calorie rows falls back to counting rows, so coverage isn't 0/0.
  const totalKcal = items.reduce((acc, item) => acc + item.kcal, 0)
  const weightOf = (item: Nutrients) => (totalKcal > 0 ? item.kcal : 1)
  const totalWeight = totalKcal > 0 ? totalKcal : items.length

  const coverage = {} as Record<MicroKey, number>
  for (const key of MICRO_KEYS) {
    const reported = items.filter((item) => item[key] !== null)
    totals[key] = reported.length === 0
      ? null
      : reported.reduce((acc, item) => acc + (item[key] ?? 0), 0)
    coverage[key] =
      totalWeight === 0 ? 0 : reported.reduce((acc, item) => acc + weightOf(item), 0) / totalWeight
  }

  return { totals: totals as Nutrients, coverage }
}

/** The same, averaged per *logged* day — see `dailyAverage` for why that denominator. */
export function dailyAverageCovered(
  entries: readonly Pick<LogEntry, 'nutrients' | 'day'>[],
): CoveredNutrients {
  const days = new Set(entries.map((entry) => entry.day)).size
  const { totals, coverage } = sumCovered(entries.map((entry) => entry.nutrients))
  return { totals: days === 0 ? { ...EMPTY_NUTRIENTS } : scale(totals, 1 / days), coverage }
}

export function dayTotals(entries: readonly Pick<LogEntry, 'nutrients'>[]): Nutrients {
  return sum(entries.map((e) => e.nutrients))
}

/**
 * A recipe's total from its ingredients.
 *
 * An unmatched ingredient contributes nothing rather than a guess — the UI flags it — and an
 * optional one is excluded, so "with a splash of cream" doesn't inflate the base dish.
 */
export function recipeNutrients(
  recipe: Pick<Recipe, 'ingredients'>,
  foods: ReadonlyMap<string, Food>,
): Nutrients {
  const parts: Nutrients[] = []
  for (const ingredient of recipe.ingredients) {
    if (ingredient.optional) continue
    const food = ingredient.foodId ? foods.get(ingredient.foodId) : undefined
    if (food) parts.push(nutrientsFor(food, ingredient.grams))
  }
  return sum(parts)
}

/** One serving of a recipe. Servings below 1 are treated as 1: a divide by zero here would put
 *  Infinity into a log entry, which no later correction can explain. */
export function perServing(recipe: Pick<Recipe, 'nutrients' | 'servings'>): Nutrients {
  return scale(recipe.nutrients, 1 / Math.max(1, recipe.servings))
}

/**
 * Average per *logged* day, not per calendar day.
 *
 * Dividing by calendar days would quietly understate everything for anyone who misses a day,
 * turning a gap in logging into an apparent nutrient deficiency.
 */
export function dailyAverage(entries: readonly Pick<LogEntry, 'nutrients' | 'day'>[]): Nutrients {
  const days = new Set(entries.map((entry) => entry.day)).size
  if (days === 0) return { ...EMPTY_NUTRIENTS }
  return scale(sum(entries.map((entry) => entry.nutrients)), 1 / days)
}

/**
 * Each macro's share of the calories it accounts for, as a percentage.
 *
 * Computed from the macros at 4/4/9 rather than from `kcal`, so the three shares add to 100 even
 * when the label's calorie figure disagrees with its macros (fibre, sugar alcohols, rounding —
 * they routinely differ by a few percent).
 */
export function macroSharePct(n: Nutrients): { proteinMg: number; carbsMg: number; fatMg: number } {
  const protein = mgToGrams(n.proteinMg) * 4
  const carbs = mgToGrams(n.carbsMg) * 4
  const fat = mgToGrams(n.fatMg) * 9
  const total = protein + carbs + fat
  if (total <= 0) return { proteinMg: 0, carbsMg: 0, fatMg: 0 }
  return {
    proteinMg: (protein / total) * 100,
    carbsMg: (carbs / total) * 100,
    fatMg: (fat / total) * 100,
  }
}

/** Grams of protein per 100 kcal — the comparison that matters when a deficit squeezes protein. */
export function proteinPer100Kcal(n: Nutrients): number {
  if (n.kcal <= 0) return 0
  return (mgToGrams(n.proteinMg) / n.kcal) * 100
}

/**
 * One day's share of a cycled target.
 *
 * Protein is held constant: it's a floor set from bodyweight, not a share of the day's calories,
 * so a low day must not quietly cut it. The difference is taken from carbs and fat in whatever
 * ratio they already have, and fat is never pushed below half its usual figure — a very low day
 * would otherwise strip out fat entirely to protect carbohydrate.
 */
export function cycleDayTargets(targets: MacroTargets, multiplier: number): MacroTargets {
  if (multiplier === 1) return targets
  const kcal = Math.round(targets.kcal * multiplier)

  const proteinKcal = mgToGrams(targets.proteinMg) * 4
  const carbsKcal = mgToGrams(targets.carbsMg) * 4
  const fatKcal = mgToGrams(targets.fatMg) * 9
  const flexible = carbsKcal + fatKcal
  if (flexible <= 0) return { ...targets, kcal }

  const share = Math.max(0, kcal - proteinKcal) / flexible
  const fatFloorKcal = fatKcal * 0.5
  const nextFatKcal = Math.max(fatFloorKcal, fatKcal * share)
  const nextCarbsKcal = Math.max(0, kcal - proteinKcal - nextFatKcal)

  return {
    kcal,
    proteinMg: targets.proteinMg,
    carbsMg: gramsToMg(nextCarbsKcal / 4),
    fatMg: gramsToMg(nextFatKcal / 9),
  }
}

/** What's left of a target. Can go negative — that's information, not an error. */
export function remaining(totals: Nutrients, targets: MacroTargets): MacroTargets {
  return {
    kcal: targets.kcal - totals.kcal,
    proteinMg: targets.proteinMg - totals.proteinMg,
    carbsMg: targets.carbsMg - totals.carbsMg,
    fatMg: targets.fatMg - totals.fatMg,
  }
}

/**
 * Splits a calorie target into macros: protein and fat are floors set by the program, carbs
 * take the remainder. Protein first because it's the target that matters most and the one a
 * deficit is likeliest to squeeze.
 */
export function splitTargets(
  kcal: number,
  bodyweightKg: number,
  proteinGPerKg: number,
  fatMinPctKcal: number,
): MacroTargets {
  const proteinG = proteinGPerKg * bodyweightKg
  const fatG = ((fatMinPctKcal / 100) * kcal) / 9
  const carbsKcal = kcal - proteinG * 4 - fatG * 9
  return {
    kcal: Math.round(kcal),
    proteinMg: gramsToMg(proteinG),
    fatMg: gramsToMg(fatG),
    // A target so low that protein and fat alone exceed it shouldn't produce negative carbs.
    carbsMg: gramsToMg(Math.max(0, carbsKcal / 4)),
  }
}

