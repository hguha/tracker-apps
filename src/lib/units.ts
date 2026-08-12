/**
 * The single place unit conversion happens (§4.12). Storage is always metric;
 * everything the user sees passes through here.
 *
 * The subtle requirement: a lb user who enters 135 stores 61.235 kg and must
 * see exactly 135 again — never 134.9 or 135.0000001.
 *
 * That used to be done by snapping display values to a **loadable plate grid**
 * (2.5 lb / 1.25 kg), which fixed the round-trip but silently changed numbers
 * that weren't on the grid: 181 lb displayed as 180, 46 as 45, 132 as 132.5, a
 * 12 lb dumbbell as 12.5. Plenty of real loads aren't multiples of 2.5 —
 * machines, fixed dumbbells, cable stacks, plate-loaded pin settings. The app
 * records what you did; it does not get to decide what you could have lifted.
 * Rounding to 2 decimals kills the float dust on its own, which was the only
 * thing the grid was actually needed for.
 */

import type { DistanceUnit, LengthUnit, WeightUnit } from '@/domain/types'

export const LB_PER_KG = 2.20462262185
const KM_PER_MI = 1.609344
const CM_PER_IN = 2.54

/**
 * Parse user-typed text into a finite number, or null.
 *
 * `Number("abc")` is `NaN`, and a stored NaN is `!== null` so it reads as a
 * "logged" value and then poisons every volume/PR/format downstream. Inputs are
 * `inputMode`-hinted but not validated by the browser (paste, desktop typing),
 * so every commit boundary must go through this rather than a bare `Number()`.
 */
export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/** Kill float dust like 134.99999999999997 without changing real precision. */
function clean(value: number, decimals = 4): number {
  return Number(value.toFixed(decimals))
}

// ---------------------------------------------------------------- weight

export function weightToKg(value: number, from: WeightUnit): number {
  return from === 'kg' ? value : value / LB_PER_KG
}

/**
 * Canonical kg back to the user's unit, at the precision a person would write.
 *
 * Two decimals: enough that a value entered in either unit round-trips exactly
 * (135 lb → 61.235 kg → 135), without inventing precision or snapping to a
 * plate grid the user never asked for.
 */
export function weightFromKg(kg: number, to: WeightUnit): number {
  return clean(to === 'kg' ? kg : kg * LB_PER_KG, 2)
}

/**
 * A body measurement in the user's unit, to one decimal.
 *
 * Bodyweight is read off a scale rather than loaded on a bar, so it wants a
 * tenth of a unit — `185.4 lb`, not `185.42`. Distinct from `weightFromKg` only
 * in precision, but naming it stops the two from being confused at call sites.
 */
export function bodyWeightFromKg(kg: number, to: WeightUnit): number {
  return clean(to === 'kg' ? kg : kg * LB_PER_KG, 1)
}

export function formatWeight(
  kg: number | null,
  unit: WeightUnit,
  opts: { withUnit?: boolean } = {},
): string {
  if (kg === null) return '—'
  // weightFromKg is pre-cleaned, so String() has no trailing zeros.
  const text = String(weightFromKg(kg, unit))
  return opts.withUnit === false ? text : `${text} ${unit}`
}

/**
 * Convert a weight to the user's unit **without** snapping to a plate increment.
 *
 * `weightFromKg` rounds to the nearest loadable plate (2.5 lb / 1.25 kg) — right
 * for a single set's weight, but wrong for a *volume total* or any derived
 * aggregate, which is a sum and not something you load on a bar. Rounding those
 * to a plate grid visibly shifts them (e.g. a 125 total landing on 120). Volume
 * and other aggregates use this instead, then round to whole units for display.
 */
export function convertWeight(kg: number, to: WeightUnit): number {
  return to === 'kg' ? kg : kg * LB_PER_KG
}

/**
 * Any *computed* weight shown to a person — a volume total, an e1RM, a projection.
 * Not `weightFromKg`, which snaps to a loadable plate and is wrong for a sum; not
 * raw `convertWeight`, which leaks floats like 250.8333 to the screen.
 */
export function displayWeight(kg: number, unit: WeightUnit): number {
  return Math.round(convertWeight(kg, unit))
}

/** `displayWeight` passing null through, for optional weights. */
export function displayWeightOrNull(kg: number | null, unit: WeightUnit): number | null {
  return kg === null ? null : displayWeight(kg, unit)
}

/** `displayWeight` as a localized string, e.g. "1,240 lb". */
export function formatDisplayWeight(
  kg: number,
  unit: WeightUnit,
  opts: { withUnit?: boolean } = {},
): string {
  const text = displayWeight(kg, unit).toLocaleString()
  return opts.withUnit === false ? text : `${text} ${unit}`
}

// -------------------------------------------------------------- distance

export function distanceToM(value: number, from: DistanceUnit): number {
  return from === 'km' ? value * 1000 : value * KM_PER_MI * 1000
}

export function distanceFromM(m: number, to: DistanceUnit): number {
  const value = to === 'km' ? m / 1000 : m / 1000 / KM_PER_MI
  return clean(value, 3)
}

export function formatDistance(
  m: number | null,
  unit: DistanceUnit,
  opts: { withUnit?: boolean } = {},
): string {
  if (m === null) return '—'
  const value = distanceFromM(m, unit)
  const text = value.toFixed(value < 10 ? 2 : 1)
  return opts.withUnit === false ? text : `${text} ${unit}`
}

// ---------------------------------------------------------------- length

export function lengthToCm(value: number, from: LengthUnit): number {
  return from === 'cm' ? value : value * CM_PER_IN
}

export function lengthFromCm(cm: number, to: LengthUnit): number {
  return clean(to === 'cm' ? cm : cm / CM_PER_IN, 2)
}

// -------------------------------------------------------- time & pace

/** Seconds to `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Wall-clock style `mm:ss` for the rest timer, which never reaches an hour. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Pace per unit distance, e.g. "8:42 / mi". Null when either input is absent. */
export function formatPace(
  durationSeconds: number | null,
  distanceM: number | null,
  unit: DistanceUnit,
): string | null {
  if (!durationSeconds || !distanceM) return null
  const distance = distanceFromM(distanceM, unit)
  if (distance <= 0) return null
  return `${formatDuration(durationSeconds / distance)} / ${unit}`
}
