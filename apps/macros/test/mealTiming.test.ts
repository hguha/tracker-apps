import { describe, expect, it } from 'vitest'
import {
  dayTiming,
  eatingOccasions,
  formatDuration,
  windowProgress,
  windowState,
} from '@/lib/mealTiming'
import { EMPTY_NUTRIENTS, type LogEntry } from '@/domain/types'

const day = '2026-09-07'

function entry(hour: number, minute: number, kcal: number): LogEntry {
  const eatenAt = Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)
  return {
    id: `e:${hour}:${minute}`,
    userId: 'u',
    day,
    eatenAt,
    meal: 'lunch',
    sortIndex: eatenAt,
    foodId: null,
    recipeId: null,
    quickAdd: null,
    fromRecipeId: null,
    dishId: null,
    dishName: null,
    grams: 0,
    portionId: null,
    portionCount: null,
    nutrients: { ...EMPTY_NUTRIENTS, kcal },
    source: 'quick',
    estimate: null,
    venue: null,
    note: '',
    createdAt: eatenAt,
    updatedAt: eatenAt,
    deletedAt: null,
    clientRev: 1,
  }
}

describe('eatingOccasions', () => {
  it('groups a sitting together and splits on a real gap', () => {
    const occasions = eatingOccasions([
      entry(12, 0, 300),
      entry(12, 20, 200),
      entry(19, 0, 700),
    ])
    expect(occasions).toHaveLength(2)
    expect(occasions[0]!.nutrients.kcal).toBe(500)
    expect(occasions[1]!.nutrients.kcal).toBe(700)
  })

  it('does not care what meal things were filed under', () => {
    // Five small occasions and one big one are the distinction this exists to show; the
    // breakfast/lunch/dinner label can't express it.
    const grazing = eatingOccasions([
      entry(9, 0, 200),
      entry(11, 0, 200),
      entry(13, 0, 200),
      entry(16, 0, 200),
      entry(19, 0, 200),
    ])
    expect(grazing).toHaveLength(5)
  })
})

describe('dayTiming', () => {
  it('reports the span and the share of the biggest occasion', () => {
    const timing = dayTiming([entry(12, 0, 400), entry(20, 0, 1600)])
    expect(timing.occasions).toBe(2)
    expect(timing.spanMinutes).toBe(480)
    expect(timing.largestShare).toBeCloseTo(0.8)
  })

  it('is empty rather than zero when nothing was logged', () => {
    expect(dayTiming([])).toMatchObject({ firstAt: null, spanMinutes: null, occasions: 0 })
  })
})

describe('windowState', () => {
  const window = { startMinute: 12 * 60, endMinute: 20 * 60 }
  const at = (hour: number) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00`)

  it('counts down to the window opening', () => {
    const state = windowState(window, [], at(10))
    expect(state.phase).toBe('before')
    expect(state.opensInMinutes).toBe(120)
  })

  it('reports what is left of an open window', () => {
    expect(windowState(window, [], at(18))).toMatchObject({ phase: 'open', closesInMinutes: 120 })
  })

  it('closes after the window', () => {
    expect(windowState(window, [], at(22)).phase).toBe('after')
  })

  it('handles a window that crosses midnight', () => {
    // Someone eating 18:00–02:00 is still inside their window at 1am; refusing to model that
    // would make the display wrong every night for exactly the people who care about timing.
    const late = { startMinute: 18 * 60, endMinute: 2 * 60 }
    expect(windowState(late, [], at(1)).phase).toBe('open')
    expect(windowState(late, [], at(15)).phase).toBe('before')
  })

  it('measures the fast from the last thing eaten', () => {
    const state = windowState(window, [entry(20, 0, 500)], at(23))
    expect(state.fastedMinutes).toBe(180)
  })
})

describe('windowProgress', () => {
  it('runs 0 to 1 across the window, and clamps outside it', () => {
    const window = { startMinute: 12 * 60, endMinute: 20 * 60 }
    const at = (hour: number) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00`)
    expect(windowProgress(window, at(12))).toBe(0)
    expect(windowProgress(window, at(16))).toBeCloseTo(0.5)
    expect(windowProgress(window, at(23))).toBe(1)
    expect(windowProgress(window, at(6))).toBe(0)
  })
})

describe('formatDuration', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(125)).toBe('2h 05m')
  })
})
