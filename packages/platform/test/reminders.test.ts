import { describe, expect, it } from 'vitest'
import { stillAhead, syncReminders, todayAt } from '../src/reminders'

const now = new Date(2026, 9, 12, 13, 30).getTime()

describe('todayAt', () => {
  it('is a minute from local midnight on the same day', () => {
    expect(new Date(todayAt(9 * 60 + 15, now)).getHours()).toBe(9)
    expect(new Date(todayAt(9 * 60 + 15, now)).getMinutes()).toBe(15)
    expect(new Date(todayAt(0, now)).getDate()).toBe(12)
  })
})

describe('stillAhead', () => {
  it('drops a reminder whose time today has passed', () => {
    const morning = { id: 1, title: 'a', body: '', at: todayAt(9 * 60, now) }
    const evening = { id: 2, title: 'b', body: '', at: todayAt(19 * 60, now) }
    expect(stillAhead([morning, evening], now)).toEqual([evening])
  })
})

describe('syncReminders', () => {
  it('refuses a reminder id the caller does not own', () => {
    expect(() =>
      syncReminders([10, 11], [{ id: 12, title: 'x', body: '', at: now + 1 }], now),
    ).toThrow(/outside/)
  })
})
