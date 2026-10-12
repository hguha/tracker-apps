import { maxPctPerWeek, paceForDate as bodyPaceForDate, type DatedPace } from '@tracker-engine/body'
import { KCAL_PER_KG_FAT } from '@/lib/expenditure'
import type { Goal, Profile } from '@/domain/types'

export const kcalFloor = (sex: Profile['sex']): number => (sex === 'female' ? 1200 : 1500)

export function safeMaxPct(inputs: {
  goal: Goal
  trendKg: number
  expenditureKcal: number | null
  floorKcal: number
}): number {
  const cap = maxPctPerWeek(inputs.goal)
  if (inputs.goal !== 'lose' || inputs.expenditureKcal === null) return cap
  const deficitRoom = inputs.expenditureKcal - inputs.floorKcal
  const floorPct = ((deficitRoom * 7) / KCAL_PER_KG_FAT / inputs.trendKg) * 100
  return Math.max(0, Math.min(cap, floorPct))
}

export function paceForDate(inputs: {
  goal: Goal
  trendKg: number
  targetKg: number
  byAt: number
  now: number
  expenditureKcal: number | null
  floorKcal: number
}): DatedPace | null {
  return bodyPaceForDate({ ...inputs, safeMaxPct: safeMaxPct(inputs) })
}
