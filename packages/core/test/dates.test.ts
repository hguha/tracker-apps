import { describe, expect, it } from 'vitest'
import {
  dayKeyOffset,
  dayStreaks,
  formatMinuteOfDay,
  formatShortDate,
  formatShortDay,
  formatTimeOfDay,
} from '../src/dates'

describe('short dates and times', () => {
  it('writes a date as "Oct 5"', () => {
    expect(formatShortDate(Date.parse('2026-10-05T09:00:00'))).toBe('Oct 5')
    expect(formatShortDay('2026-10-12')).toBe('Oct 12')
  })

  it('writes a time and a minute of the day the same way', () => {
    const at = Date.parse('2026-10-05T13:05:00')
    expect(formatMinuteOfDay(13 * 60 + 5)).toBe(formatTimeOfDay(at))
    expect(formatTimeOfDay(at)).toMatch(/1:05\s?PM|13:05/)
  })
})

const at = (iso: string) => Date.parse(`${iso}T12:00:00`)

describe('dayKeyOffset', () => {
  it('walks the calendar, including across a month boundary', () => {
    expect(dayKeyOffset(at('2026-03-01'), 1)).toBe('2026-02-28')
    expect(dayKeyOffset(at('2026-09-07'), 7)).toBe('2026-08-31')
  })
})

describe('dayStreaks', () => {
  it('counts the current run up to today', () => {
    const days = ['2026-09-05', '2026-09-06', '2026-09-07']
    expect(dayStreaks(days, at('2026-09-07'))).toEqual({ current: 3, best: 3 })
  })

  it("doesn't break the run for a today that isn't over", () => {
    const days = ['2026-09-05', '2026-09-06']
    expect(dayStreaks(days, at('2026-09-07')).current).toBe(2)
  })

  it('treats a gap as a break, and remembers the best run', () => {
    const days = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-09-06', '2026-09-07']
    expect(dayStreaks(days, at('2026-09-07'))).toEqual({ current: 2, best: 3 })
  })

  it('is zero with nothing logged', () => {
    expect(dayStreaks([], at('2026-09-07'))).toEqual({ current: 0, best: 0 })
  })
})
