import { mgToGrams } from '@/lib/nutrition'
import type { Nutrients, Profile } from '@/domain/types'

/**
 * Whether a day's food was nutritionally complete, not just on target for calories.
 *
 * Deliberately understated in the UI. Someone tracking macros is not asking to be nagged about
 * potassium, and a red warning about a nutrient the database simply didn't record would be
 * worse than silence. So the rule here is: only judge what was actually measured, and say when
 * there wasn't enough data to judge.
 *
 * Reference intakes are adult daily values (FDA, rounded). Not clinical advice, and not
 * age/sex/pregnancy-specific — enough to say "you're consistently short on fibre", which is the
 * useful claim, and not enough to pretend to more precision than that.
 */

export interface NutrientTarget {
  key: keyof Nutrients
  label: string
  /** Daily reference intake, in the field's own unit (mg). */
  reference: number
  /** True when more is better and the reference is a floor; false when it's a ceiling. */
  isFloor: boolean
}

export const NUTRIENT_TARGETS: NutrientTarget[] = [
  { key: 'fiberMg', label: 'Fibre', reference: 28_000, isFloor: true },
  { key: 'potassiumMg', label: 'Potassium', reference: 4_700, isFloor: true },
  { key: 'calciumMg', label: 'Calcium', reference: 1_300, isFloor: true },
  { key: 'ironMg', label: 'Iron', reference: 18, isFloor: true },
  // Ceilings: the useful signal is being consistently over, not under.
  { key: 'sodiumMg', label: 'Sodium', reference: 2_300, isFloor: false },
  { key: 'satFatMg', label: 'Saturated fat', reference: 20_000, isFloor: false },
  { key: 'sugarMg', label: 'Added sugar', reference: 50_000, isFloor: false },
]

export type NutrientVerdict = 'short' | 'ok' | 'over' | 'unknown'

export interface NutrientStatus extends NutrientTarget {
  /** null when nothing logged that day recorded this nutrient. */
  amount: number | null
  /** Fraction of the reference, or null when unknown. */
  ratio: number | null
  verdict: NutrientVerdict
}

/** Below this fraction of a floor counts as short; a ceiling is "over" above 1. */
const SHORT_BELOW = 0.7

export function nutrientStatus(totals: Nutrients): NutrientStatus[] {
  return NUTRIENT_TARGETS.map((target) => {
    const amount = totals[target.key]
    if (amount === null) {
      return { ...target, amount: null, ratio: null, verdict: 'unknown' as const }
    }
    const ratio = amount / target.reference
    const verdict: NutrientVerdict = target.isFloor
      ? ratio < SHORT_BELOW
        ? 'short'
        : 'ok'
      : ratio > 1
        ? 'over'
        : 'ok'
    return { ...target, amount, ratio, verdict }
  })
}

export interface DietQuality {
  /** 0–100, over what could actually be judged. null when nothing was measurable. */
  score: number | null
  short: NutrientStatus[]
  over: NutrientStatus[]
  /** How many of the tracked nutrients the day's food had no data for. */
  unknownCount: number
  summary: string
}

/**
 * Scores only the nutrients that were measured.
 *
 * Counting an unrecorded nutrient as zero would punish the user for the database's gaps —
 * Open Food Facts rows in particular routinely carry macros and nothing else — so the score is
 * a fraction of what was knowable, and `unknownCount` is surfaced so a high score built on two
 * data points can't masquerade as a clean bill of health.
 */
export function dietQuality(totals: Nutrients): DietQuality {
  const statuses = nutrientStatus(totals)
  const known = statuses.filter((s) => s.verdict !== 'unknown')
  const short = known.filter((s) => s.verdict === 'short')
  const over = known.filter((s) => s.verdict === 'over')

  if (known.length === 0) {
    return {
      score: null,
      short: [],
      over: [],
      unknownCount: statuses.length,
      summary: "Not enough nutrient data in today's foods to say.",
    }
  }

  const score = Math.round(((known.length - short.length - over.length) / known.length) * 100)
  return {
    score,
    short,
    over,
    unknownCount: statuses.length - known.length,
    summary: summarize(short, over),
  }
}

function summarize(short: NutrientStatus[], over: NutrientStatus[]): string {
  if (short.length === 0 && over.length === 0) return 'Everything measured is in a good range.'
  const parts: string[] = []
  if (short.length > 0) parts.push(`low on ${list(short.map((s) => s.label.toLowerCase()))}`)
  if (over.length > 0) parts.push(`high on ${list(over.map((s) => s.label.toLowerCase()))}`)
  return `Today looks ${parts.join(', and ')}.`
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** For display: mg is right for micros, grams for the ones people think of in grams. */
export function formatAmount(status: NutrientStatus): string {
  const grams = ['fiberMg', 'satFatMg', 'sugarMg']
  if (status.amount === null) return '—'
  return grams.includes(status.key)
    ? `${Math.round(mgToGrams(status.amount))}g`
    : `${Math.round(status.amount)}mg`
}

/** Bodyweight goal, for the Today header. Derived, never stored — the program owns the intent
 *  and the trend owns the number, so a stored "goal weight" would just go stale. */
export function goalWeightKg(
  trendKg: number,
  ratePctPerWeek: number,
  weeks = 12,
): number | null {
  if (ratePctPerWeek === 0) return null
  return trendKg * (1 + (ratePctPerWeek / 100) * weeks)
}

export function heightForBmi(profile: Pick<Profile, 'heightCm'>): number | null {
  return profile.heightCm && profile.heightCm > 0 ? profile.heightCm : null
}

export function bmi(trendKg: number, heightCm: number): number {
  const metres = heightCm / 100
  return trendKg / (metres * metres)
}
