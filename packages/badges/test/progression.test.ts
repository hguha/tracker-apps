import { describe, expect, it } from 'vitest'
import { celebrationsSince, levelFor, nextBadges, type CelebratedBadge } from '../src'

const badge = (key: string, earned: boolean): CelebratedBadge => ({
  key,
  label: key.toUpperCase(),
  caption: `${key} caption`,
  icon: '🏅',
  earned,
})

const day = '2026-10-04'

describe('levelFor', () => {
  it('needs 100 more XP for each level after the first', () => {
    expect(levelFor(0)).toEqual({ level: 1, xp: 0, floor: 0, next: 100 })
    expect(levelFor(100)).toEqual({ level: 2, xp: 100, floor: 100, next: 300 })
    expect(levelFor(599).level).toBe(3)
    expect(levelFor(600).level).toBe(4)
  })
})

describe('celebrationsSince', () => {
  it('stays quiet the first time so an existing history is not a flood', () => {
    const { celebrations, next } = celebrationsSince(null, {
      badges: [badge('a', true)],
      level: 4,
      day,
      dayComplete: false,
    })
    expect(celebrations).toEqual([])
    expect(next).toEqual({ badges: ['a'], level: 4, completedDay: null })
  })

  it('celebrates a new badge and a level once each', () => {
    const before = { badges: [], level: 1, completedDay: null }
    const now = { badges: [badge('a', true), badge('b', false)], level: 2, day, dayComplete: false }
    const first = celebrationsSince(before, now)
    expect(first.celebrations.map((c) => c.title)).toEqual(['A', 'Level 2'])
    expect(celebrationsSince(first.next, now).celebrations).toEqual([])
  })

  it('folds several new badges into one', () => {
    const { celebrations } = celebrationsSince(
      { badges: [], level: 1, completedDay: null },
      { badges: [badge('a', true), badge('b', true)], level: 1, day, dayComplete: false },
    )
    expect(celebrations).toHaveLength(1)
    expect(celebrations[0]!.title).toBe('2 badges earned')
  })

  it('never celebrates a level twice after it drops and comes back', () => {
    const before = { badges: [], level: 3, completedDay: null }
    const { next } = celebrationsSince(before, { badges: [], level: 2, day, dayComplete: false })
    expect(next.level).toBe(3)
    expect(
      celebrationsSince(next, { badges: [], level: 3, day, dayComplete: false }).celebrations,
    ).toEqual([])
  })
})

describe('nextBadges', () => {
  it('picks the unearned ones closest to done', () => {
    const all = [
      { key: 'a', earned: true, fraction: 1 },
      { key: 'b', earned: false, fraction: 0.2 },
      { key: 'c', earned: false, fraction: 0.8 },
      { key: 'd', earned: false, fraction: 0.5 },
    ]
    expect(nextBadges(all, 2).map((b) => b.key)).toEqual(['c', 'd'])
  })
})
