import { WEEK_MS } from '@tracker-engine/core'
import { KCAL_PER_KG_FAT } from '@/lib/expenditure'
import type { Goal, Profile } from '@/domain/types'

export const MAX_LOSS_PCT_PER_WEEK = 1
export const MAX_GAIN_PCT_PER_WEEK = 0.5
export const KCAL_FLOOR = { female: 1200, male: 1500 } as const

export const kcalFloor = (sex: Profile['sex']): number =>
  sex === 'female' ? KCAL_FLOOR.female : KCAL_FLOOR.male

export function safeMaxPct(inputs: {
  goal: Goal
  trendKg: number
  expenditureKcal: number | null
  sex: Profile['sex']
}): number {
  if (inputs.goal === 'maintain') return 0
  if (inputs.goal === 'gain') return MAX_GAIN_PCT_PER_WEEK
  if (inputs.expenditureKcal === null) return MAX_LOSS_PCT_PER_WEEK
  const deficitRoom = inputs.expenditureKcal - kcalFloor(inputs.sex)
  const floorPct = ((deficitRoom * 7) / KCAL_PER_KG_FAT / inputs.trendKg) * 100
  return Math.max(0, Math.min(MAX_LOSS_PCT_PER_WEEK, floorPct))
}

export interface DatedPace {
  ratePctPerWeek: number
  isTooSoon: boolean
  earliestAt: number | null
}

const toHundredths = (pct: number, round: (n: number) => number) => round(pct * 100) / 100

export function paceForDate(inputs: {
  goal: Goal
  trendKg: number
  targetKg: number
  byAt: number
  now: number
  expenditureKcal: number | null
  sex: Profile['sex']
}): DatedPace | null {
  const direction = inputs.goal === 'lose' ? -1 : inputs.goal === 'gain' ? 1 : 0
  const neededKg = inputs.targetKg - inputs.trendKg
  if (direction === 0 || Math.sign(neededKg) !== direction) return null

  const maxPct = toHundredths(safeMaxPct(inputs), Math.floor)
  if (maxPct <= 0) return { ratePctPerWeek: 0, isTooSoon: true, earliestAt: null }

  const neededPct = (Math.abs(neededKg) / inputs.trendKg) * 100
  const weeks = (inputs.byAt - inputs.now) / WEEK_MS
  const requiredPct = weeks > 0 ? toHundredths(neededPct / weeks, Math.ceil) : Infinity
  const isTooSoon = requiredPct > maxPct
  const pct = isTooSoon ? maxPct : requiredPct

  return {
    ratePctPerWeek: direction * pct,
    isTooSoon,
    earliestAt: isTooSoon ? inputs.now + (neededPct / maxPct) * WEEK_MS : null,
  }
}
