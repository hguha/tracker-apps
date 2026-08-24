// Storage is always metric (§4.12); everything the user sees is converted here.

import type { DistanceUnit, LengthUnit, WeightUnit } from '@/domain/types'

export const LB_PER_KG = 2.20462262185
const KM_PER_MI = 1.609344
const CM_PER_IN = 2.54

// A stored NaN reads as `!== null`, so it counts as a logged value and poisons
// every downstream sum. Every commit boundary parses through this.
export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function clean(value: number, decimals = 4): number {
  return Number(value.toFixed(decimals))
}

// The finest increment a person would enter in each unit — enough to preserve
// real loads (2.5 lb / 1.25 kg plates) while resolving conversion dust like
// 80.01. kg is stored canonically so it barely needs it; lb always converts.
const DISPLAY_INCREMENT: Record<WeightUnit, number> = { lb: 0.5, kg: 0.25 }

function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment
}

export function weightToKg(value: number, from: WeightUnit): number {
  return from === 'kg' ? value : value / LB_PER_KG
}

// Snapped to the unit's finest real increment so a converted value reads as a
// weight a person would write (80, not 80.01) while round-tripping what they
// entered. clean() first, so 39.999→40 rather than sitting between increments.
export function weightFromKg(kg: number, to: WeightUnit): number {
  return roundToIncrement(
    clean(to === 'kg' ? kg : kg * LB_PER_KG, 2),
    DISPLAY_INCREMENT[to],
  )
}

// Bodyweight comes off a scale, so it keeps a tenth: 185.4, not 185.5.
export function bodyWeightFromKg(kg: number, to: WeightUnit): number {
  return clean(to === 'kg' ? kg : kg * LB_PER_KG, 1)
}

export function formatWeight(
  kg: number | null,
  unit: WeightUnit,
  opts: { withUnit?: boolean } = {},
): string {
  if (kg === null) return '—'
  const text = String(weightFromKg(kg, unit))
  return opts.withUnit === false ? text : `${text} ${unit}`
}

// Unrounded conversion, for aggregates (a volume total isn't loaded on a bar,
// so it must not snap to 0.5).
export function convertWeight(kg: number, to: WeightUnit): number {
  return to === 'kg' ? kg : kg * LB_PER_KG
}

// A computed weight shown to a person — volume total, e1RM, projection.
export function displayWeight(kg: number, unit: WeightUnit): number {
  return Math.round(convertWeight(kg, unit))
}

export function displayWeightOrNull(kg: number | null, unit: WeightUnit): number | null {
  return kg === null ? null : displayWeight(kg, unit)
}

export function formatDisplayWeight(
  kg: number,
  unit: WeightUnit,
  opts: { withUnit?: boolean } = {},
): string {
  const text = displayWeight(kg, unit).toLocaleString()
  return opts.withUnit === false ? text : `${text} ${unit}`
}

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

export function lengthToCm(value: number, from: LengthUnit): number {
  return from === 'cm' ? value : value * CM_PER_IN
}

export function lengthFromCm(cm: number, to: LengthUnit): number {
  return clean(to === 'cm' ? cm : cm / CM_PER_IN, 2)
}

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

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

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
