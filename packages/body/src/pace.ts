import { WEEK_MS } from '@tracker-engine/core'
import type { Goal } from './goal'

export const RATES: Record<Goal, { value: number; label: string }[]> = {
  lose: [
    { value: -0.25, label: 'Gentle' },
    { value: -0.5, label: 'Steady' },
    { value: -0.75, label: 'Fast' },
  ],
  gain: [
    { value: 0.125, label: 'Lean' },
    { value: 0.25, label: 'Steady' },
    { value: 0.5, label: 'Fast' },
  ],
  maintain: [{ value: 0, label: 'Hold' }],
}

export function paceLabel(goal: Goal, ratePctPerWeek: number): string | null {
  return RATES[goal].find((rate) => rate.value === ratePctPerWeek)?.label ?? null
}

export const defaultRate = (goal: Goal): number => RATES[goal][goal === 'maintain' ? 0 : 1]!.value

const MAX_PCT_PER_WEEK: Record<Goal, number> = { lose: 1, gain: 0.5, maintain: 0 }

export const maxPctPerWeek = (goal: Goal): number => MAX_PCT_PER_WEEK[goal]

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
  safeMaxPct: number
}): DatedPace | null {
  const direction = inputs.goal === 'lose' ? -1 : inputs.goal === 'gain' ? 1 : 0
  const neededKg = inputs.targetKg - inputs.trendKg
  if (direction === 0 || Math.sign(neededKg) !== direction) return null

  const maxPct = toHundredths(inputs.safeMaxPct, Math.floor)
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
