import { describe, expect, it } from 'vitest'
import { levelFor } from '@tracker-engine/badges'
import { experience, goalWeeksMet, shownExperience } from '@/features/home/progression'

const at = (iso: string) => Date.parse(`${iso}T18:00:00`)

describe('experience', () => {
  it('rewards days trained, records and weeks on goal, not volume', () => {
    expect(experience({ totalDaysTrained: 3, recordSessions: 0, goalWeeks: 0 })).toBe(30)
    expect(experience({ totalDaysTrained: 1, recordSessions: 2, goalWeeks: 1 })).toBe(45)
    expect(levelFor(experience({ totalDaysTrained: 10, recordSessions: 0, goalWeeks: 0 })).level).toBe(2)
  })
})

describe('goalWeeksMet', () => {
  it('counts weeks that reached the weekly workout goal', () => {
    const workouts = [
      at('2026-10-05'),
      at('2026-10-07'),
      at('2026-10-09'),
      at('2026-10-13'),
      at('2026-10-20'),
      at('2026-10-21'),
    ]
    expect(goalWeeksMet(workouts, 1, 2)).toBe(2)
    expect(goalWeeksMet(workouts, 1, 3)).toBe(1)
    expect(goalWeeksMet([], 1, 2)).toBe(0)
  })
})

describe('shownExperience', () => {
  it('never shows less than the most this account has reached', () => {
    localStorage.clear()
    expect(shownExperience('reputation.xp.a', 300)).toBe(300)
    expect(shownExperience('reputation.xp.a', 120)).toBe(300)
    expect(shownExperience('reputation.xp.a', 340)).toBe(340)
    expect(shownExperience('reputation.xp.b', 50)).toBe(50)
  })
})
