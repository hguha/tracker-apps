import { mgToGrams } from '@/lib/nutrition'
import type { Nutrients } from '@/domain/types'

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

interface NutrientTarget {
  key: keyof Nutrients
  label: string
  /** Daily reference intake, in the field's own unit (mg). */
  reference: number
  /** True when more is better and the reference is a floor; false when it's a ceiling. */
  isFloor: boolean
}

export type ReferenceSex = 'male' | 'female' | null

/**
 * Reference intakes, adjusted for sex where the sexes genuinely differ.
 *
 * Iron is the reason this isn't one flat list: the label Daily Value is 18 mg, set for
 * menstruating women, and applying it to a man flags him as short of iron more or less every day
 * — a warning that is wrong and that teaches people to ignore the whole panel. Fibre and potassium
 * differ too, so those use the DRI figures; the rest are label Daily Values, which is what
 * packaging quotes. Informational, not clinical, and not age- or pregnancy-specific.
 */
export function nutrientTargets(sex: ReferenceSex = null): NutrientTarget[] {
  const isFemale = sex === 'female'
  return [
    { key: 'fiberMg', label: 'Fibre', reference: isFemale ? 25_000 : 34_000, isFloor: true },
    {
      key: 'potassiumMg',
      label: 'Potassium',
      reference: isFemale ? 2_600 : 3_400,
      isFloor: true,
    },
    { key: 'calciumMg', label: 'Calcium', reference: 1_000, isFloor: true },
    { key: 'ironMg', label: 'Iron', reference: isFemale ? 18 : 8, isFloor: true },
    // Ceilings: the useful signal is being consistently over, not under.
    { key: 'sodiumMg', label: 'Sodium', reference: 2_300, isFloor: false },
    { key: 'satFatMg', label: 'Saturated fat', reference: 20_000, isFloor: false },
    // "Sugars", not "Added sugar": USDA records total sugars, so a banana reports 12 g of it and
    // has no added sugar at all. The 50 g reference *is* the added-sugar Daily Value, kept as a
    // rough ceiling because there is no total-sugars one — but labelling the field with it made the
    // app tell people their fruit was half a day's added sugar.
    { key: 'sugarMg', label: 'Sugars', reference: 50_000, isFloor: false },
  ]
}

/** The unadjusted set, for anything that has no profile to hand. */
export const NUTRIENT_TARGETS: NutrientTarget[] = nutrientTargets(null)

type NutrientVerdict = 'short' | 'ok' | 'over' | 'unknown'

interface NutrientStatus extends NutrientTarget {
  /** null when nothing logged recorded this nutrient at all. */
  amount: number | null
  /** Fraction of the reference, or null when unknown. */
  ratio: number | null
  verdict: NutrientVerdict
  /** Share of the period's calories from foods that reported it, 0–1. */
  coverage: number
}

/** Below this fraction of a floor counts as short; a ceiling is "over" above 1. */
const SHORT_BELOW = 0.7

/**
 * Below this share of the day's calories, a total isn't worth judging.
 *
 * Not zero, and not one. The old rule was effectively one — a single food missing a figure made the
 * whole day's nutrient unknown — which is why a day could report no fibre at all. But judging 26 g of
 * fibre as "short" when half the day's calories never reported any would be worse than saying nothing.
 * Two thirds is the point where the measured total is a useful floor.
 */
const MIN_COVERAGE = 0.66

export function nutrientStatus(
  totals: Nutrients,
  sex: ReferenceSex = null,
  coverage: Partial<Record<keyof Nutrients, number>> = {},
): NutrientStatus[] {
  return nutrientTargets(sex).map((target) => {
    const amount = totals[target.key]
    // Absent coverage means the caller didn't measure it — treat as fully covered rather than
    // silently reporting everything as unknown.
    const covered = coverage[target.key] ?? 1
    if (amount === null || covered < MIN_COVERAGE) {
      return { ...target, amount, ratio: null, verdict: 'unknown' as const, coverage: covered }
    }
    const ratio = amount / target.reference
    const verdict: NutrientVerdict = target.isFloor
      ? ratio < SHORT_BELOW
        ? 'short'
        : 'ok'
      : ratio > 1
        ? 'over'
        : 'ok'
    return { ...target, amount, ratio, verdict, coverage: covered }
  })
}

interface DietQuality {
  short: NutrientStatus[]
  over: NutrientStatus[]
  onTarget: NutrientStatus[]
  /** How many of the tracked nutrients had data at all. */
  measured: number
  tracked: number
  /** One line: what's off, and how much of the picture is actually visible. */
  summary: string
}

/**
 * Which nutrients are short, high, or fine — and nothing more.
 *
 * Deliberately not a score. A single percentage was actively misleading here: it read as "how
 * healthy your diet is" while it really meant "of the nutrients your foods happened to record,
 * this fraction were in range", so eating one high-fibre food could show 57% and a day of
 * branded foods carrying only macros could show 100%. Two numbers doing different jobs
 * cannot be averaged into one that means anything, so this reports the nutrients by name and
 * says how many it could not judge.
 *
 * Unmeasured is never zero: Open Food Facts rows in particular routinely carry macros and
 * nothing else, and counting those as an absence would punish the user for a gap in the
 * database.
 */
export function dietQuality(
  totals: Nutrients,
  sex: ReferenceSex = null,
  coverage: Partial<Record<keyof Nutrients, number>> = {},
): DietQuality {
  const statuses = nutrientStatus(totals, sex, coverage)
  const known = statuses.filter((s) => s.verdict !== 'unknown')
  const short = known.filter((s) => s.verdict === 'short')
  const over = known.filter((s) => s.verdict === 'over')

  return {
    short,
    over,
    onTarget: known.filter((s) => s.verdict === 'ok'),
    measured: known.length,
    tracked: statuses.length,
    summary: summarize(short, over, known.length, statuses.length),
  }
}

function summarize(
  short: NutrientStatus[],
  over: NutrientStatus[],
  measured: number,
  tracked: number,
): string {
  if (measured === 0) return 'No nutrient data in these foods yet.'
  const coverage = measured < tracked ? ` · ${measured} of ${tracked} recorded` : ''
  if (short.length === 0 && over.length === 0) {
    return `Everything recorded is in range${coverage}`
  }
  const parts: string[] = []
  if (short.length > 0) parts.push(`low on ${list(short.map((s) => s.label.toLowerCase()))}`)
  if (over.length > 0) parts.push(`high on ${list(over.map((s) => s.label.toLowerCase()))}`)
  return `${capitalize(parts.join(', '))}${coverage}`
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** For display: mg is right for micros, grams for the ones people think of in grams. */
export function formatAmount(status: Pick<NutrientStatus, 'key' | 'amount'>): string {
  const grams = ['fiberMg', 'satFatMg', 'sugarMg']
  if (status.amount === null) return '—'
  if (grams.includes(status.key)) return `${Math.round(mgToGrams(status.amount))}g`
  // A decimal under 10 mg, because rounding is the difference between "a little" and "none". A
  // banana's 0.26 mg of iron printed as "0mg", which reads as a food containing no iron — and this
  // is now shown per 100 g of a single food, where sub-milligram figures are the normal case.
  if (status.amount > 0 && status.amount < 10) return `${status.amount.toFixed(1)}mg`
  return `${Math.round(status.amount)}mg`
}

/**
 * Why a nutrient couldn't be judged, in the user's terms.
 *
 * "Not recorded" is true but useless when the real situation is "two thirds of your food reported it
 * and the steak didn't" — that's actionable, because the fix is correcting one row.
 */
export function coverageNote(status: NutrientStatus): string {
  if (status.amount === null) return 'none of these foods record it'
  const pct = Math.round(status.coverage * 100)
  return `only ${pct}% of what you ate records it`
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

export function bmi(trendKg: number, heightCm: number): number {
  const metres = heightCm / 100
  return trendKg / (metres * metres)
}
