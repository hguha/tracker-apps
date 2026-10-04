import type { CyclingConfig } from '@/domain/types'

/**
 * Calorie cycling: the same week's calories, distributed unevenly.
 *
 * It changes nothing the algorithm measures — the multipliers average to 1, so the weekly total
 * (which is what moves the weight trend, and what the check-in actually controls) is untouched.
 * What it buys is adherence: a bigger Saturday is easier to plan for than to apologise for.
 *
 * Days are Sunday-first, matching `Date.getDay()`, so a weekday index never needs converting at a
 * call site.
 */

/** How much more a high day gets, before the low days are rebalanced to compensate. */
const HIGH_DAY_BOOST = 0.15

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Multipliers that give `highDays` more and the rest proportionally less, averaging exactly 1.
 *
 * Returns null when every day or no day is picked: both mean "no cycling", and storing a config of
 * seven 1s would leave the UI unable to tell "off" from "on but flat".
 */
export function multipliersForHighDays(
  highDays: readonly number[],
  boost = HIGH_DAY_BOOST,
): number[] | null {
  const high = new Set(highDays.filter((day) => day >= 0 && day <= 6))
  if (high.size === 0 || high.size === 7) return null

  const lowCount = 7 - high.size
  // Whatever the high days take, the low days give back, so the week's total is preserved.
  const deficitPerLowDay = (high.size * boost) / lowCount
  return DAY_NAMES.map((_, day) => (high.has(day) ? 1 + boost : 1 - deficitPerLowDay))
}

export function highDaysOf(cycling: CyclingConfig | null): number[] {
  if (!cycling) return []
  return cycling.multipliers.flatMap((value, day) => (value > 1 ? [day] : []))
}

/** The multiplier for a `yyyy-MM-dd` day. 1 when cycling is off, so callers need no branch. */
export function multiplierForDay(cycling: CyclingConfig | null, day: string): number {
  if (!cycling || cycling.multipliers.length !== 7) return 1
  const weekday = new Date(`${day}T12:00:00`).getDay()
  return cycling.multipliers[weekday] ?? 1
}
