/**
 * Units: storage is always metric, everything a person sees is converted here.
 *
 * Shared because two apps in the family both show bodyweight, and having each convert it its own
 * way is how one of them ends up storing pounds. MACROcosm shipped with a units *setting* that
 * changed nothing at all — every screen printed kg regardless — which is the same class of bug
 * from the other end.
 */

export type WeightUnit = 'lb' | 'kg'
export type DistanceUnit = 'mi' | 'km'
export type LengthUnit = 'in' | 'cm'
export type VolumeUnit = 'floz' | 'ml'

/** One switch per app, so "imperial" can't mean lb here and in there. */
export interface UnitPreference {
  weight: WeightUnit
  length: LengthUnit
  distance: DistanceUnit
  /** Only MACROcosm shows a volume; it lives here so "imperial" means one thing everywhere. */
  volume: VolumeUnit
}

export const METRIC: UnitPreference = {
  weight: 'kg',
  length: 'cm',
  distance: 'km',
  volume: 'ml',
}
export const IMPERIAL: UnitPreference = {
  weight: 'lb',
  length: 'in',
  distance: 'mi',
  volume: 'floz',
}

/** For apps that store one metric/imperial flag rather than three separate units. */
export const unitsFor = (system: 'metric' | 'imperial'): UnitPreference =>
  system === 'imperial' ? IMPERIAL : METRIC

export const LB_PER_KG = 2.20462262185
const KM_PER_MI = 1.609344
const CM_PER_IN = 2.54
/** US fluid ounce. Storage is millilitres, exactly like weight is kilograms. */
const ML_PER_FLOZ = 29.5735295625

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

export function volumeToMl(value: number, from: VolumeUnit): number {
  return from === 'ml' ? value : value * ML_PER_FLOZ
}

export function volumeFromMl(ml: number, to: VolumeUnit): number {
  return clean(to === 'ml' ? ml : ml / ML_PER_FLOZ, 1)
}

/** Litres, for a chart axis. Here rather than inline so volume arithmetic stays in one file. */
export function litresFromMl(ml: number): number {
  return clean(ml / 1000, 2)
}

/**
 * Rounded to something a person would say: whole fluid ounces, millilitres below a litre, and one
 * decimal above it — "1.8 L", not "1.75 L". Water is counted in glasses, so the second decimal is
 * precision the number doesn't have.
 */
export function formatVolume(ml: number, unit: VolumeUnit): string {
  // Rounded from the raw conversion, not from `volumeFromMl`'s one-decimal result: 250 ml is
  // 8.45 fl oz, which that rounds to 8.5, which `Math.round` then rounds *up* to 9.
  if (unit === 'floz') return `${Math.round(ml / ML_PER_FLOZ)} fl oz`
  return ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${Math.round(ml)} ml`
}
