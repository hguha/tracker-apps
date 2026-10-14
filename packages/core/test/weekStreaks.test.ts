import { describe, expect, it, vi } from 'vitest'
import { weekStart, weekStreaks } from '../src/dates'

const WEEK_MS = 7 * 24 * 3600 * 1000
// Monday week start throughout.
const wk = (n: number) => weekStart(Date.now(), 1) + n * WEEK_MS

describe('weekStreaks', () => {
  it('is zero for no history', () => {
    expect(weekStreaks([], 1)).toEqual({ current: 0, best: 0 })
  })

  it('counts a run ending this week', () => {
    // Trained this week, last week, two weeks ago.
    const s = weekStreaks([wk(0), wk(-1), wk(-2)], 1)
    expect(s.current).toBe(3)
    expect(s.best).toBe(3)
  })

  it('does not break the current streak when this week is not trained yet', () => {
    // Last week and the week before, but nothing logged this week so far.
    const s = weekStreaks([wk(-1), wk(-2)], 1)
    expect(s.current).toBe(2)
  })

  it('breaks the current streak on a genuinely missed week', () => {
    // This week and two weeks ago, but last week was missed.
    const s = weekStreaks([wk(0), wk(-2), wk(-3)], 1)
    expect(s.current).toBe(1) // only this week
    expect(s.best).toBe(2) // the -2,-3 run
  })

  it('finds the best run in the past even when the current streak is short', () => {
    // A 4-week block long ago, nothing recent.
    const s = weekStreaks([wk(-10), wk(-11), wk(-12), wk(-13)], 1)
    expect(s.best).toBe(4)
    expect(s.current).toBe(0)
  })

  it('collapses multiple sessions in one week into a single streak week', () => {
    const s = weekStreaks([wk(0) + 1000, wk(0) + 2000, wk(-1)], 1)
    expect(s.current).toBe(2)
    expect(s.best).toBe(2)
  })
})

describe('weekStreaks across a clock change', () => {
  it('keeps counting back through a 167-hour spring-forward week', () => {
    vi.stubEnv('TZ', 'America/New_York')
    try {
      const sessions = [new Date(2027, 2, 3, 18).getTime(), new Date(2027, 2, 10, 18).getTime(), new Date(2027, 2, 15, 9).getTime()]
      expect(weekStreaks(sessions, 1, new Date(2027, 2, 15, 10).getTime()).current).toBe(3)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
