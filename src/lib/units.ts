/**
 * The single place unit conversion happens (§4.12). Storage is always metric;
 * everything the user sees passes through here.
 *
 * The subtle requirement: a lb user who enters 135 stores 61.235 kg and must
 * see exactly 135 again — never 134.9 or 135.0000001. So display conversion
 * snaps to the nearest increment that is actually loadable in the target unit.
 */

import type { DistanceUnit, LengthUnit, WeightUnit } from '@/domain/types'

const LB_PER_KG = 2.20462262185
const KM_PER_MI = 1.609344
const CM_PER_IN = 2.54

/** Smallest weight change you can actually make, per unit. */
const DEFAULT_INCREMENT: Record<WeightUnit, number> = {
  lb: 2.5, // a pair of 1.25 lb plates
  kg: 1.25, // a pair of 0.625 kg plates
}

function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment
}

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
 * Canonical kg to the user's unit, snapped to a loadable increment.
 *
 * `increment` is overridable per exercise for micro-plates or for machines
 * with unusual jumps.
 */
export function weightFromKg(
  kg: number,
  to: WeightUnit,
  increment = DEFAULT_INCREMENT[to],
): number {
  const raw = to === 'kg' ? kg : kg * LB_PER_KG
  return clean(roundToIncrement(raw, increment), 2)
}

export function formatWeight(
  kg: number | null,
  unit: WeightUnit,
  opts: { withUnit?: boolean } = {},
): string {
  if (kg === null) return '—'
  // weightFromKg already returns a cleaned number (e.g. 65, 12.5), so String()
  // gives "65" / "12.5" with no trailing zeros — no extra formatting needed.
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
 * A derived or aggregate weight — a volume total, an estimated 1RM, a projected
 * max — converted to the user's unit and rounded to a whole number for display.
 *
 * This is the one function to reach for whenever a *computed* weight is shown.
 * `weightFromKg` snaps to a loadable plate (wrong for a sum); raw `convertWeight`
 * returns exact floats like 250.8333 (wrong for the screen). Everything derived
 * that a person reads goes through here so no long decimal ever leaks to the UI.
 */
export function displayWeight(kg: number, unit: WeightUnit): number {
  return Math.round(convertWeight(kg, unit))
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
