import { describe, expect, it } from 'vitest'
import {
  estimateInitialExpenditure,
  filterExpenditure,
  KCAL_PER_KG_FAT,
  kcalPerKg,
  MAX_TARGET_STEP_KCAL,
  stepToward,
  targetKcal,
  windowEstimate,
  type ExpenditureWindow,
} from '@/lib/expenditure'
import type { BodyWeight } from '@tracker-engine/body'

function weights(start: number, perDay: number, days = 7): BodyWeight[] {
  return Array.from({ length: days }, (_, i) => ({
    id: `d${i}`,
    day: `2026-09-${String(i + 1).padStart(2, '0')}`,
    kg: start + perDay * i,
    source: 'macros',
    updatedAt: 1,
    deletedAt: null,
  }))
}

function intake(kcal: number, days = 7) {
  return Array.from({ length: days }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, '0')}`,
    kcal,
  }))
}

describe('kcalPerKg', () => {
  it('prices loss at the fat figure', () => {
    expect(kcalPerKg('lose', -0.5)).toBe(KCAL_PER_KG_FAT)
  })

  it('prices slow gain cheaper than fast gain, since it is leaner', () => {
    expect(kcalPerKg('gain', 0.1)).toBeLessThan(kcalPerKg('gain', 0.9))
  })

  it('never exceeds the fat figure', () => {
    expect(kcalPerKg('gain', 5)).toBeLessThanOrEqual(KCAL_PER_KG_FAT)
  })
})

describe('windowEstimate', () => {
  it('reports intake as expenditure when weight is stable', () => {
    const w = windowEstimate('2026-09-01', intake(2500), weights(80, 0), KCAL_PER_KG_FAT)!
    expect(w.estimateKcal).toBeCloseTo(2500, 0)
  })

  it('reports expenditure above intake when the trend is falling', () => {
    const w = windowEstimate('2026-09-01', intake(2000), weights(80, -0.07), KCAL_PER_KG_FAT)!
    expect(w.estimateKcal).toBeGreaterThan(2000)
  })

  it('refuses to estimate from too few logged days', () => {
    expect(windowEstimate('2026-09-01', intake(2000, 3), weights(80, 0), KCAL_PER_KG_FAT)).toBeNull()
  })

  it('refuses to estimate from too few weigh-ins', () => {
    expect(
      windowEstimate('2026-09-01', intake(2000), weights(80, 0, 2), KCAL_PER_KG_FAT),
    ).toBeNull()
  })

  it('trusts a partial week less than a full one', () => {
    const full = windowEstimate('2026-09-01', intake(2200), weights(80, 0), KCAL_PER_KG_FAT)!
    const partial = windowEstimate('2026-09-01', intake(2200, 5), weights(80, 0, 5), KCAL_PER_KG_FAT)!
    expect(partial.variance).toBeGreaterThan(full.variance)
  })
})

describe('filterExpenditure', () => {
  const w = (estimateKcal: number, variance = 3000): ExpenditureWindow => ({
    weekStart: '2026-09-01',
    meanIntakeKcal: estimateKcal,
    daysLogged: 7,
    trendKg: 80,
    trendChangeKgPerWeek: 0,
    estimateKcal,
    variance,
  })

  it('settles toward a consistent signal instead of jumping to it', () => {
    const first = filterExpenditure([w(2600)], { kcal: 2400, se: 200 })!
    expect(first.kcal).toBeGreaterThan(2400)
    expect(first.kcal).toBeLessThan(2600)
  })

  it('converges as windows accumulate', () => {
    const many = filterExpenditure(Array.from({ length: 10 }, () => w(2600)), { kcal: 2400, se: 200 })!
    expect(Math.abs(many.kcal - 2600)).toBeLessThan(40)
  })

  it('shrinks the error bar with more evidence', () => {
    const one = filterExpenditure([w(2600)], { kcal: 2400, se: 300 })!
    const five = filterExpenditure(Array.from({ length: 5 }, () => w(2600)), { kcal: 2400, se: 300 })!
    expect(five.se).toBeLessThan(one.se)
  })

  it('barely moves for a noisy window', () => {
    const noisy = filterExpenditure([w(3400, 500_000)], { kcal: 2400, se: 100 })!
    expect(Math.abs(noisy.kcal - 2400)).toBeLessThan(30)
  })

  it('keeps the prior when there is nothing new', () => {
    const prior = { kcal: 2400, se: 150 }
    expect(filterExpenditure([], prior)).toEqual(prior)
  })
})

describe('targetKcal', () => {
  it('equals expenditure when maintaining', () => {
    expect(targetKcal({ kcal: 2500, se: 100 }, { goal: 'maintain', ratePctPerWeek: 0 }, 80)).toBe(2500)
  })

  it('sits below expenditure for a deficit', () => {
    expect(
      targetKcal({ kcal: 2500, se: 100 }, { goal: 'lose', ratePctPerWeek: -0.5 }, 80),
    ).toBeLessThan(2500)
  })

  it('sits above expenditure for a surplus', () => {
    expect(
      targetKcal({ kcal: 2500, se: 100 }, { goal: 'gain', ratePctPerWeek: 0.25 }, 80),
    ).toBeGreaterThan(2500)
  })
})

describe('stepToward', () => {
  it('takes a small move whole', () => {
    expect(stepToward(2400, 2500)).toBe(2500)
  })

  it('caps a large move so a noisy week cannot whipsaw the user', () => {
    expect(stepToward(2400, 3200)).toBe(2400 + MAX_TARGET_STEP_KCAL)
    expect(stepToward(2400, 1000)).toBe(2400 - MAX_TARGET_STEP_KCAL)
  })
})

describe('estimateInitialExpenditure', () => {
  const base = { kg: 80, heightCm: 180, age: 30, sex: 'male' as const }

  it('rises with training frequency', () => {
    const rest = estimateInitialExpenditure({ ...base, sessionsPerWeek: 0 })
    const trained = estimateInitialExpenditure({ ...base, sessionsPerWeek: 5 })
    expect(trained.kcal).toBeGreaterThan(rest.kcal)
  })

  it('carries a wide error bar, being a population average', () => {
    expect(estimateInitialExpenditure({ ...base, sessionsPerWeek: 3 }).se).toBeGreaterThan(250)
  })

  it('lands in a plausible range', () => {
    const est = estimateInitialExpenditure({ ...base, sessionsPerWeek: 3 })
    expect(est.kcal).toBeGreaterThan(2000)
    expect(est.kcal).toBeLessThan(3400)
  })
})
