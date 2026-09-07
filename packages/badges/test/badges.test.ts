import { describe, expect, it } from 'vitest'
import {
  countBadge,
  evaluateBadges,
  groupBadges,
  ratio,
  sanitizeStats,
  startedBadges,
  type Badge,
} from '../src'

interface Stats {
  days: number
  perDay: number
}

const badges: Badge<Stats, 'A' | 'B'>[] = [
  countBadge<Stats, 'A' | 'B'>('one', 'One', 'Log a day.', '1️⃣', 'A', (s) => s.days, 1),
  countBadge<Stats, 'A' | 'B'>('ten', 'Ten', 'Log ten days.', '🔟', 'A', (s) => s.days, 10),
  countBadge<Stats, 'A' | 'B'>('rate', 'Rate', 'Average two a day.', '📈', 'B', (s) => s.perDay, 2),
]

describe('evaluateBadges', () => {
  it('marks the earned ones and clamps the fraction', () => {
    const states = evaluateBadges(badges, { days: 4, perDay: 5 })
    const byKey = new Map(states.map((state) => [state.key, state]))
    expect(byKey.get('one')!.earned).toBe(true)
    expect(byKey.get('one')!.fraction).toBe(1)
    expect(byKey.get('ten')!.fraction).toBeCloseTo(0.4)
  })

  it('puts earned first, then whatever is closest', () => {
    const states = evaluateBadges(badges, { days: 4, perDay: 0.5 })
    expect(states[0]!.earned).toBe(true)
    const unearned = states.filter((state) => !state.earned)
    expect(unearned[0]!.key).toBe('ten')
  })

  it('renders a non-finite stat as zero rather than NaN', () => {
    const states = evaluateBadges(badges, { days: 1, perDay: Number.NaN })
    expect(states.find((state) => state.key === 'rate')!.detailText).toBe('0 / 2')
  })
})

describe('startedBadges', () => {
  it('hides untouched targets', () => {
    const states = evaluateBadges(badges, { days: 4, perDay: 0 })
    expect(startedBadges(states).map((state) => state.key)).toEqual(['one', 'ten'])
  })

  it('falls back to the closest badge so a new user sees something', () => {
    const states = evaluateBadges(badges, { days: 0, perDay: 0 })
    expect(startedBadges(states)).toHaveLength(1)
  })
})

describe('groupBadges', () => {
  it('keeps the given order and drops empty groups', () => {
    const states = evaluateBadges(badges, { days: 1, perDay: 1 })
    expect(groupBadges(states, ['B', 'A']).map((section) => section.group)).toEqual(['B', 'A'])
    expect(groupBadges(states, ['A']).map((section) => section.group)).toEqual(['A'])
  })
})

describe('ratio and sanitizeStats', () => {
  it('never divides by zero or returns NaN', () => {
    expect(ratio(5, 0)).toBe(0)
    expect(ratio(Number.NaN, 5)).toBe(0)
  })

  it('leaves finite numbers alone', () => {
    expect(sanitizeStats({ days: 3, perDay: Number.POSITIVE_INFINITY })).toEqual({
      days: 3,
      perDay: 0,
    })
  })
})
