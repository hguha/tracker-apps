import { describe, expect, it } from 'vitest'
import { evaluateBadges, type LifetimeStats } from './badges'

function stats(partial: Partial<LifetimeStats> = {}): LifetimeStats {
  return {
    totalWorkouts: 0,
    totalSets: 0,
    totalVolumeKg: 0,
    bestWeekStreak: 0,
    currentWeekStreak: 0,
    ...partial,
  }
}

describe('evaluateBadges', () => {
  it('marks a badge earned once its threshold is met', () => {
    const result = evaluateBadges(stats({ totalWorkouts: 1 }))
    const first = result.find((b) => b.key === 'first-workout')!
    expect(first.earned).toBe(true)
    expect(first.fraction).toBe(1)
  })

  it('reports partial progress on an unearned badge', () => {
    const century = evaluateBadges(stats({ totalWorkouts: 50 })).find(
      (b) => b.key === 'century',
    )!
    expect(century.earned).toBe(false)
    expect(century.fraction).toBeCloseTo(0.5)
    expect(century.detail(stats({ totalWorkouts: 50 }))).toBe('50 / 100')
  })

  it('clamps fraction to 1 even when the stat overshoots', () => {
    const first = evaluateBadges(stats({ totalWorkouts: 999 })).find(
      (b) => b.key === 'first-workout',
    )!
    expect(first.fraction).toBe(1)
  })

  it('sorts earned badges ahead of unearned', () => {
    const result = evaluateBadges(stats({ totalWorkouts: 10 }))
    const earnedIndexes = result.map((b, i) => (b.earned ? i : -1)).filter((i) => i >= 0)
    const unearnedIndexes = result
      .map((b, i) => (!b.earned ? i : -1))
      .filter((i) => i >= 0)
    expect(Math.max(...earnedIndexes)).toBeLessThan(Math.min(...unearnedIndexes))
  })

  it('orders unearned badges by closest-to-earning first', () => {
    // 8 workouts: 'ten-workouts' (0.8) should precede 'century' (0.08).
    const result = evaluateBadges(stats({ totalWorkouts: 8 })).filter((b) => !b.earned)
    const ten = result.findIndex((b) => b.key === 'ten-workouts')
    const century = result.findIndex((b) => b.key === 'century')
    expect(ten).toBeLessThan(century)
  })

  it('scores the 1M club as a percentage of a million pounds', () => {
    // ~226,796 kg is roughly half a million pounds.
    const half = evaluateBadges(stats({ totalVolumeKg: 226_796 })).find(
      (b) => b.key === 'million-club',
    )!
    expect(half.fraction).toBeCloseTo(0.5, 1)
    expect(half.detail(stats({ totalVolumeKg: 226_796 }))).toBe('50%')
  })
})
