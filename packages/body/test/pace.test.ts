import { describe, expect, it } from 'vitest'
import { WEEK_MS } from '@tracker-engine/core'
import { defaultRate, maxPctPerWeek, paceForDate, paceLabel } from '../src/pace'

const NOW = Date.parse('2026-10-04T12:00:00')
const base = { goal: 'lose' as const, trendKg: 100, targetKg: 90, now: NOW, safeMaxPct: 1 }

describe('paceForDate', () => {
  it('sets the pace that reaches the goal weight by the date', () => {
    expect(paceForDate({ ...base, byAt: NOW + 20 * WEEK_MS })).toEqual({
      ratePctPerWeek: -0.5,
      isTooSoon: false,
      earliestAt: null,
    })
  })

  it('holds a date too soon to the safe limit and names the earliest safe date', () => {
    const pace = paceForDate({ ...base, byAt: NOW + 4 * WEEK_MS })
    expect(pace).toEqual({ ratePctPerWeek: -1, isTooSoon: true, earliestAt: NOW + 10 * WEEK_MS })
  })

  it('reports no room when the safe limit is zero', () => {
    expect(paceForDate({ ...base, safeMaxPct: 0, byAt: NOW + 20 * WEEK_MS })).toEqual({
      ratePctPerWeek: 0,
      isTooSoon: true,
      earliestAt: null,
    })
  })

  it('has nothing to say when the goal weight is the other way, or for maintain', () => {
    expect(paceForDate({ ...base, targetKg: 110, byAt: NOW + 20 * WEEK_MS })).toBeNull()
    expect(paceForDate({ ...base, goal: 'maintain', byAt: NOW + 20 * WEEK_MS })).toBeNull()
  })
})

describe('named paces', () => {
  it('labels the named rates and defaults to Steady', () => {
    expect(paceLabel('lose', -0.5)).toBe('Steady')
    expect(paceLabel('lose', -0.6)).toBeNull()
    expect(defaultRate('gain')).toBe(0.25)
    expect(defaultRate('maintain')).toBe(0)
  })

  it('caps loss at 1% and gain at 0.5% of bodyweight a week', () => {
    expect([maxPctPerWeek('lose'), maxPctPerWeek('gain'), maxPctPerWeek('maintain')]).toEqual([
      1, 0.5, 0,
    ])
  })
})
