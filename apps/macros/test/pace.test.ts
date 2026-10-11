import { describe, expect, it } from 'vitest'
import { WEEK_MS } from '@tracker-engine/core'
import { kcalFloor, paceForDate, safeMaxPct } from '@/lib/pace'
import { targetKcal } from '@/lib/expenditure'

const NOW = Date.parse('2026-10-04T12:00:00')
const base = {
  goal: 'lose' as const,
  trendKg: 100,
  targetKg: 90,
  now: NOW,
  expenditureKcal: 3000,
  sex: 'male' as const,
}

describe('paceForDate', () => {
  it('sets the pace that reaches the goal weight by the date', () => {
    const pace = paceForDate({ ...base, byAt: NOW + 20 * WEEK_MS })
    expect(pace).toEqual({ ratePctPerWeek: -0.5, isTooSoon: false, earliestAt: null })
  })

  it('caps loss at 1% a week and names the earliest safe date', () => {
    const pace = paceForDate({ ...base, byAt: NOW + 4 * WEEK_MS })
    expect(pace?.ratePctPerWeek).toBe(-1)
    expect(pace?.isTooSoon).toBe(true)
    expect(pace?.earliestAt).toBe(NOW + 10 * WEEK_MS)
  })

  it('caps gain at 0.5% a week', () => {
    const pace = paceForDate({ ...base, goal: 'gain', targetKg: 105, byAt: NOW + 2 * WEEK_MS })
    expect(pace?.ratePctPerWeek).toBe(0.5)
    expect(pace?.isTooSoon).toBe(true)
    expect(pace?.earliestAt).toBe(NOW + 10 * WEEK_MS)
  })

  it('never takes calories below the floor', () => {
    const pace = paceForDate({
      ...base,
      trendKg: 60,
      targetKg: 55,
      expenditureKcal: 1800,
      sex: 'female',
      byAt: NOW + 2 * WEEK_MS,
    })
    expect(pace?.isTooSoon).toBe(true)
    const kcal = targetKcal({ kcal: 1800, se: 0 }, { goal: 'lose', ratePctPerWeek: pace!.ratePctPerWeek }, 60)
    expect(kcal).toBeGreaterThanOrEqual(kcalFloor('female'))
    expect(pace!.ratePctPerWeek).toBeLessThan(0)
  })

  it('treats a date in the past as too soon', () => {
    expect(paceForDate({ ...base, byAt: NOW - WEEK_MS })?.isTooSoon).toBe(true)
  })

  it('has nothing to say when the goal weight is the other way', () => {
    expect(paceForDate({ ...base, targetKg: 110, byAt: NOW + 20 * WEEK_MS })).toBeNull()
  })

  it('reports no room when expenditure is already at the floor', () => {
    expect(
      paceForDate({ ...base, expenditureKcal: 1500, byAt: NOW + 20 * WEEK_MS }),
    ).toEqual({ ratePctPerWeek: 0, isTooSoon: true, earliestAt: null })
  })
})

describe('safeMaxPct', () => {
  it('uses the stricter floor when sex is unknown', () => {
    expect(kcalFloor(null)).toBe(1500)
    expect(safeMaxPct({ goal: 'lose', trendKg: 100, expenditureKcal: null, sex: null })).toBe(1)
  })
})

describe('the calorie floor holds for every losing pace', () => {
  it('never sets a losing target under the floor, whatever pace was picked', () => {
    const program = { goal: 'lose' as const, ratePctPerWeek: -1 }
    expect(targetKcal({ kcal: 1800, se: 100 }, program, 60, kcalFloor('female'))).toBe(1200)
    expect(targetKcal({ kcal: 1800, se: 100 }, program, 60, kcalFloor('male'))).toBe(1500)
  })

  it('leaves a gain alone', () => {
    const program = { goal: 'gain' as const, ratePctPerWeek: 0.25 }
    expect(targetKcal({ kcal: 1400, se: 100 }, program, 60, 1500)).toBeLessThan(1500 + 1000)
    expect(targetKcal({ kcal: 1400, se: 100 }, program, 60, 1500)).toBeGreaterThan(1400)
  })
})
