import { describe, expect, it } from 'vitest'
import { computeStreaks } from './streaks'
import { weekStart } from '@/lib/dates'

const WEEK_MS = 7 * 24 * 3600 * 1000
// Monday week start throughout.
const wk = (n: number) => weekStart(Date.now(), 1) + n * WEEK_MS

describe('computeStreaks', () => {
  it('is zero for no history', () => {
    expect(computeStreaks([], 1)).toEqual({ currentWeekStreak: 0, bestWeekStreak: 0 })
  })

  it('counts a run ending this week', () => {
    // Trained this week, last week, two weeks ago.
    const s = computeStreaks([wk(0), wk(-1), wk(-2)], 1)
    expect(s.currentWeekStreak).toBe(3)
    expect(s.bestWeekStreak).toBe(3)
  })

  it('does not break the current streak when this week is not trained yet', () => {
    // Last week and the week before, but nothing logged this week so far.
    const s = computeStreaks([wk(-1), wk(-2)], 1)
    expect(s.currentWeekStreak).toBe(2)
  })

  it('breaks the current streak on a genuinely missed week', () => {
    // This week and two weeks ago, but last week was missed.
    const s = computeStreaks([wk(0), wk(-2), wk(-3)], 1)
    expect(s.currentWeekStreak).toBe(1) // only this week
    expect(s.bestWeekStreak).toBe(2) // the -2,-3 run
  })

  it('finds the best run in the past even when the current streak is short', () => {
    // A 4-week block long ago, nothing recent.
    const s = computeStreaks([wk(-10), wk(-11), wk(-12), wk(-13)], 1)
    expect(s.bestWeekStreak).toBe(4)
    expect(s.currentWeekStreak).toBe(0)
  })

  it('collapses multiple sessions in one week into a single streak week', () => {
    const s = computeStreaks([wk(0) + 1000, wk(0) + 2000, wk(-1)], 1)
    expect(s.currentWeekStreak).toBe(2)
    expect(s.bestWeekStreak).toBe(2)
  })
})
