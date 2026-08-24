import { describe, expect, it } from 'vitest'
import {
  bigThreeTotalKg,
  evaluateBadges,
  groupedBadges,
  homeBadges,
  type LifetimeStats,
} from '@/features/home/badges'

const KG_PER_LB = 1 / 2.20462262185
const lb = (pounds: number) => pounds * KG_PER_LB

function stats(partial: Partial<LifetimeStats> = {}): LifetimeStats {
  return {
    totalWorkouts: 0,
    totalSets: 0,
    totalVolumeKg: 0,
    bestWeekStreak: 0,
    currentWeekStreak: 0,
    bestSquatE1rmKg: 0,
    bestBenchE1rmKg: 0,
    bestDeadliftE1rmKg: 0,
    bestAnyE1rmKg: 0,
    totalCardioMeters: 0,
    totalCardioSeconds: 0,
    distinctExercises: 0,
    ...partial,
  }
}

describe('evaluateBadges', () => {
  it('marks a badge earned once its threshold is met', () => {
    const result = evaluateBadges(stats({ totalWorkouts: 1 }))
    const first = result.find((b) => b.key === 'first-workout')!
    expect(first.earned).toBe(true)
    expect(first.fraction).toBe(1)
  })

  it('reports partial progress on an unearned badge', () => {
    const century = evaluateBadges(stats({ totalWorkouts: 50 })).find(
      (b) => b.key === 'century',
    )!
    expect(century.earned).toBe(false)
    expect(century.fraction).toBeCloseTo(0.5)
    expect(century.detail(stats({ totalWorkouts: 50 }))).toBe('50 / 100')
  })

  it('clamps fraction to 1 even when the stat overshoots', () => {
    const first = evaluateBadges(stats({ totalWorkouts: 999 })).find(
      (b) => b.key === 'first-workout',
    )!
    expect(first.fraction).toBe(1)
  })

  it('sorts earned badges ahead of unearned', () => {
    const result = evaluateBadges(stats({ totalWorkouts: 10 }))
    const earnedIndexes = result.map((b, i) => (b.earned ? i : -1)).filter((i) => i >= 0)
    const unearnedIndexes = result
      .map((b, i) => (!b.earned ? i : -1))
      .filter((i) => i >= 0)
    expect(Math.max(...earnedIndexes)).toBeLessThan(Math.min(...unearnedIndexes))
  })

  it('orders unearned badges by closest-to-earning first', () => {
    // 8 workouts: 'ten-workouts' (0.8) should precede 'century' (0.08).
    const result = evaluateBadges(stats({ totalWorkouts: 8 })).filter((b) => !b.earned)
    const ten = result.findIndex((b) => b.key === 'ten-workouts')
    const century = result.findIndex((b) => b.key === 'century')
    expect(ten).toBeLessThan(century)
  })

  it('scores the 1M club as a percentage of a million pounds', () => {
    // ~226,796 kg is roughly half a million pounds.
    const half = evaluateBadges(stats({ totalVolumeKg: 226_796 })).find(
      (b) => b.key === 'million-club',
    )!
    expect(half.fraction).toBeCloseTo(0.5, 1)
    expect(half.detail(stats({ totalVolumeKg: 226_796 }))).toBe('50%')
  })
})

describe('strength club badges', () => {
  it('earns the 1000 lb club on a big-three total in pounds', () => {
    const s = stats({
      bestSquatE1rmKg: lb(400),
      bestBenchE1rmKg: lb(275),
      bestDeadliftE1rmKg: lb(405),
    })
    expect(Math.round(bigThreeTotalKg(s) * 2.20462262185)).toBe(1080)
    const club = evaluateBadges(s).find((b) => b.key === 'club-1000')!
    expect(club.earned).toBe(true)
    // The 1500 club is still a way off.
    expect(evaluateBadges(s).find((b) => b.key === 'club-1500')!.earned).toBe(false)
  })

  it('renders a strength detail in pounds, not kg', () => {
    const club = evaluateBadges(stats({ bestBenchE1rmKg: lb(185) })).find(
      (b) => b.key === 'bench-225',
    )!
    expect(club.detailText).toBe('185 / 225 lb')
  })

  it('earns a single-lift plate badge at the threshold', () => {
    const twoPlate = evaluateBadges(stats({ bestBenchE1rmKg: lb(225) })).find(
      (b) => b.key === 'bench-225',
    )!
    expect(twoPlate.earned).toBe(true)
  })
})

describe('cardio badges', () => {
  it('earns the first-mile badge once a mile is logged', () => {
    const b = evaluateBadges(stats({ totalCardioMeters: 1609.344 })).find(
      (x) => x.key === 'cardio-first',
    )!
    expect(b.earned).toBe(true)
  })

  it('tracks marathon progress in whole miles', () => {
    const b = evaluateBadges(stats({ totalCardioMeters: 1609.344 * 13 })).find(
      (x) => x.key === 'cardio-marathon',
    )!
    expect(b.earned).toBe(false)
    expect(b.detailText).toBe('13 / 26 mi')
  })

  it('earns the cardio-hours badge on total time', () => {
    const b = evaluateBadges(stats({ totalCardioSeconds: 11 * 3600 })).find(
      (x) => x.key === 'cardio-10h',
    )!
    expect(b.earned).toBe(true)
  })
})

describe('non-finite guards (the NaN bug)', () => {
  it('never produces a NaN fraction or detail from bad stats', () => {
    // Simulate corrupt/old data: NaN and undefined leaking into the stats.
    const bad = {
      ...stats(),
      totalVolumeKg: NaN,
      bestBenchE1rmKg: undefined as unknown as number,
      totalCardioMeters: NaN,
    }
    const result = evaluateBadges(bad)
    for (const b of result) {
      expect(Number.isFinite(b.fraction)).toBe(true)
      expect(b.detailText).not.toContain('NaN')
    }
  })
})

describe('homeBadges', () => {
  it('shows only badges earned or in progress, hiding untouched ones', () => {
    // One workout: milestone badges start progressing; a 500-mile cardio badge
    // stays untouched and should be hidden.
    const shown = homeBadges(evaluateBadges(stats({ totalWorkouts: 1 })))
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((b) => b.earned || b.fraction > 0)).toBe(true)
    expect(shown.some((b) => b.key === 'cardio-500mi')).toBe(false)
  })

  it('falls back to the single closest badge for a brand-new user', () => {
    const shown = homeBadges(evaluateBadges(stats()))
    expect(shown).toHaveLength(1)
  })
})

describe('groupedBadges', () => {
  it('splits the catalog into ordered, non-empty sections', () => {
    const groups = groupedBadges(evaluateBadges(stats()))
    expect(groups.map((g) => g.group)).toEqual([
      'Milestones',
      'Consistency',
      'Strength',
      'Volume',
      'Cardio',
    ])
    expect(groups.every((g) => g.badges.length > 0)).toBe(true)
  })
})
