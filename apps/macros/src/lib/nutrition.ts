import {
  CORE_NUTRIENT_KEYS,
  EMPTY_NUTRIENTS,
  NUTRIENT_KEYS,
  type Food,
  type FoodPortion,
  type LogEntry,
  type MacroTargets,
  type Nutrients,
} from '@/domain/types'

/**
 * The one place nutrient arithmetic happens. Every screen, chart, target and AI caller
 * reads from here, so they cannot disagree — the same rule that stopped REPutation's coach
 * and home screen reporting different volumes. Enforced by scripts/check-architecture.mjs.
 */

const MG_PER_G = 1000

export const gramsToMg = (g: number): number => Math.round(g * MG_PER_G)
export const mgToGrams = (mg: number): number => mg / MG_PER_G

export function portionFor(food: Food, portionId: string | null): FoodPortion | null {
  if (portionId) return food.portions.find((p) => p.id === portionId) ?? null
  return food.portions.find((p) => p.isDefault) ?? food.portions[0] ?? null
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

export function dayTotals(entries: readonly Pick<LogEntry, 'nutrients'>[]): Nutrients {
  return sum(entries.map((e) => e.nutrients))
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

/** Grams of protein per 100 kcal — the comparison that matters when a deficit squeezes protein. */
export function proteinPer100Kcal(n: Nutrients): number {
  if (n.kcal <= 0) return 0
  return (mgToGrams(n.proteinMg) / n.kcal) * 100
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

