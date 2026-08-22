import { describe, expect, it } from 'vitest'
import { DAY_MS, WEEK_MS, weekOffset } from '@/lib/dates'

const at = (isoDate: string) => Date.parse(`${isoDate}T12:00:00`)

describe('date constants + weekOffset', () => {
  it('has the canonical spans', () => {
    expect(DAY_MS).toBe(86_400_000)
    expect(WEEK_MS).toBe(7 * 86_400_000)
  })

  it('weekOffset is 0 for the current week and negative for past weeks', () => {
    // 2024-06-12 is a Wednesday; Monday-start weeks.
    const now = at('2024-06-12')
    expect(weekOffset(at('2024-06-12'), 1, now)).toBe(0)
    expect(weekOffset(at('2024-06-10'), 1, now)).toBe(0) // same week (Mon)
    expect(weekOffset(at('2024-06-05'), 1, now)).toBe(-1) // prior week
    expect(weekOffset(at('2024-05-29'), 1, now)).toBe(-2)
  })

  it('respects the week-start day', () => {
    // Sunday 2024-06-09: offset 0 under Sunday-start, −1 under Monday-start.
    const now = at('2024-06-12')
    expect(weekOffset(at('2024-06-09'), 0, now)).toBe(0)
    expect(weekOffset(at('2024-06-09'), 1, now)).toBe(-1)
  })
})
