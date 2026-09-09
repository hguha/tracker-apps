import { describe, expect, it } from 'vitest'
import { highDaysOf, multiplierForDay, multipliersForHighDays } from '@/lib/cycling'
import { cycleDayTargets, mgToGrams } from '@/lib/nutrition'

describe('multipliersForHighDays', () => {
  it('averages exactly 1, so the week total is untouched', () => {
    // The whole claim of cycling: a bigger Saturday costs a smaller Tuesday, not a bigger week.
    for (const days of [[6], [0, 6], [1, 3, 5], [2]]) {
      const multipliers = multipliersForHighDays(days)!
      const mean = multipliers.reduce((sum, value) => sum + value, 0) / 7
      expect(mean).toBeCloseTo(1, 10)
    }
  })

  it('raises the picked days and lowers the rest', () => {
    const multipliers = multipliersForHighDays([6])!
    expect(multipliers[6]).toBeGreaterThan(1)
    expect(multipliers[2]).toBeLessThan(1)
  })

  it('treats all days or no days as off', () => {
    expect(multipliersForHighDays([])).toBeNull()
    expect(multipliersForHighDays([0, 1, 2, 3, 4, 5, 6])).toBeNull()
  })

  it('round-trips through highDaysOf', () => {
    const multipliers = multipliersForHighDays([0, 6])!
    expect(highDaysOf({ multipliers })).toEqual([0, 6])
  })
})

describe('multiplierForDay', () => {
  it('reads the weekday of a day key', () => {
    const multipliers = multipliersForHighDays([6])! // Saturday
    // 2026-09-12 is a Saturday.
    expect(multiplierForDay({ multipliers }, '2026-09-12')).toBeGreaterThan(1)
    expect(multiplierForDay({ multipliers }, '2026-09-09')).toBeLessThan(1)
  })

  it('is 1 when cycling is off', () => {
    expect(multiplierForDay(null, '2026-09-12')).toBe(1)
  })
})

describe('cycleDayTargets', () => {
  const targets = { kcal: 2000, proteinMg: 150_000, carbsMg: 200_000, fatMg: 60_000 }

  it('holds protein constant while scaling the day', () => {
    const high = cycleDayTargets(targets, 1.15)
    const low = cycleDayTargets(targets, 0.85)
    expect(high.proteinMg).toBe(targets.proteinMg)
    expect(low.proteinMg).toBe(targets.proteinMg)
    expect(high.kcal).toBe(2300)
    expect(low.kcal).toBe(1700)
  })

  it('keeps the macros roughly consistent with the day calories', () => {
    const high = cycleDayTargets(targets, 1.15)
    const implied =
      mgToGrams(high.proteinMg) * 4 + mgToGrams(high.carbsMg) * 4 + mgToGrams(high.fatMg) * 9
    expect(Math.abs(implied - high.kcal)).toBeLessThan(20)
  })

  it('never strips fat below half on a very low day', () => {
    const veryLow = cycleDayTargets(targets, 0.5)
    expect(mgToGrams(veryLow.fatMg)).toBeGreaterThanOrEqual(mgToGrams(targets.fatMg) * 0.5 - 0.01)
  })

  it('is a no-op at 1', () => {
    expect(cycleDayTargets(targets, 1)).toEqual(targets)
  })
})
