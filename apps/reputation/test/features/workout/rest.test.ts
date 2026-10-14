import { describe, expect, it } from 'vitest'
import { lastLiftRestSeconds, restSecondsFor, type RestRow } from '@/features/workout/rest'

const profile = { defaultRestSeconds: 90 }

function row(
  movementPattern: 'push' | 'cardio',
  restSeconds: number | null,
  defaultRestSeconds: number | null,
): RestRow {
  return { workoutExercise: { restSeconds }, exercise: { movementPattern, defaultRestSeconds } }
}

describe('restSecondsFor', () => {
  it('prefers the session row, then the exercise, then the profile', () => {
    expect(restSecondsFor(row('push', 45, 120), profile)).toBe(45)
    expect(restSecondsFor(row('push', null, 120), profile)).toBe(120)
    expect(restSecondsFor(row('push', null, null), profile)).toBe(90)
  })
})

describe('lastLiftRestSeconds', () => {
  it('uses the last lift rather than a cardio row logged after it', () => {
    const rows = [row('push', null, 120), row('cardio', null, 30)]
    expect(lastLiftRestSeconds(rows, profile)).toBe(120)
  })

  it("never borrows an earlier lift's rest for the last lift", () => {
    const rows = [row('push', null, 150), row('push', null, null)]
    expect(lastLiftRestSeconds(rows, profile)).toBe(90)
  })

  it('falls back to the profile with no lifts', () => {
    expect(lastLiftRestSeconds([row('cardio', null, null)], profile)).toBe(90)
  })
})
