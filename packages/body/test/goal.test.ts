import { describe, expect, it } from 'vitest'
import { DAY_MS, WEEK_MS, dayKey } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend, type BodyWeight } from '../src/weight'
import { etaAt, goalProgress, scaleRate } from '../src/goal'

const NOW = Date.parse('2026-10-04T12:00:00')
const weeksFromNow = (at: number | null) => (at === null ? null : (at - NOW) / WEEK_MS)
const NOISE = [0.3, -0.2, 0.4, -0.4, 0.1, 0.2, -0.3, 0, 0.35, -0.15, 0.25, -0.35, 0.05, -0.1]

function weighIns(
  startKg: number,
  plan: { flatDays?: number; days: number; kgPerWeek: number; noisy?: boolean; every?: number },
): BodyWeight[] {
  const flat = plan.flatDays ?? 0
  const total = flat + plan.days
  const every = plan.every ?? 1
  const out: BodyWeight[] = []
  for (let i = 0; i < total; i += every) {
    const lost = i < flat ? 0 : ((i - flat) * plan.kgPerWeek) / 7
    out.push({
      id: `w${i}`,
      day: dayKey(NOW - (total - i) * DAY_MS),
      kg: startKg + lost + (plan.noisy === false ? 0 : NOISE[i % NOISE.length]!),
      source: 'test',
      updatedAt: 1,
      deletedAt: null,
    })
  }
  return out
}

describe('goalProgress', () => {
  const losing = { goal: 'lose' as const, targetKg: 75, startKg: 85, trendKg: 80 }

  it('reports the fraction of the way from where the goal was set', () => {
    expect(goalProgress(losing).fraction).toBeCloseTo(0.5, 3)
  })

  it('knows when a losing goal is met, and a gaining one', () => {
    expect(goalProgress({ ...losing, trendKg: 74.8 }).isReached).toBe(true)
    expect(goalProgress({ ...losing, trendKg: 75.2 }).isReached).toBe(false)
    expect(
      goalProgress({ goal: 'gain', targetKg: 85, startKg: 80, trendKg: 85.1 }).isReached,
    ).toBe(true)
  })

  it('never reports a maintain program as reached', () => {
    expect(
      goalProgress({ goal: 'maintain', targetKg: 80, startKg: 80, trendKg: 80 }).isReached,
    ).toBe(false)
  })

  it('has no fraction without a start weight', () => {
    expect(goalProgress({ ...losing, startKg: null }).fraction).toBeNull()
  })

  it('reports remaining as signed, so past-the-target reads as past', () => {
    expect(goalProgress({ ...losing, trendKg: 74 }).remainingKg).toBeCloseTo(-1)
  })
})

describe('scaleRate', () => {
  it('reads the true slope without the EWMA lag the old endpoint rate had', () => {
    const trend = weightTrend(weighIns(80, { days: 10, kgPerWeek: -0.6, noisy: false }))
    expect(scaleRate(trend, NOW)!.kgPerWeek).toBeCloseTo(-0.6, 2)
    expect(trendChangePerWeek(trend)!).toBeGreaterThan(-0.3)
  })

  it('ignores weigh-ins from before the behaviour being measured began', () => {
    const trend = weightTrend(weighIns(80, { flatDays: 120, days: 21, kgPerWeek: -0.6, noisy: false }))
    const since = NOW - 21 * DAY_MS - DAY_MS / 2
    expect(scaleRate(trend, NOW, since)!.kgPerWeek).toBeCloseTo(-0.6, 2)
    expect(scaleRate(trend, NOW)!.kgPerWeek).toBeGreaterThan(-0.6)
  })

  it('needs at least three weigh-ins across a few days', () => {
    expect(scaleRate(weightTrend(weighIns(80, { days: 2, kgPerWeek: -1 })), NOW)).toBeNull()
    expect(scaleRate(weightTrend(weighIns(80, { days: 3, kgPerWeek: -1 })), NOW)).toBeNull()
    expect(scaleRate(weightTrend(weighIns(80, { days: 5, kgPerWeek: -1 })), NOW)).not.toBeNull()
  })

  it('grows more certain with more weigh-ins over a longer span', () => {
    const few = scaleRate(weightTrend(weighIns(80, { days: 7, kgPerWeek: -0.5 })), NOW)!
    const many = scaleRate(weightTrend(weighIns(80, { days: 28, kgPerWeek: -0.5 })), NOW)!
    const sparse = scaleRate(weightTrend(weighIns(80, { days: 28, kgPerWeek: -0.5, every: 4 })), NOW)!
    expect(many.se).toBeLessThan(few.se)
    expect(many.se).toBeLessThan(sparse.se)
    expect(many.weighIns).toBe(28)
  })
})

describe('etaAt', () => {
  it('divides the distance by the rate', () => {
    expect(weeksFromNow(etaAt(-2, -0.5, NOW))).toBeCloseTo(4)
  })

  it('refuses a date when flat, going the wrong way, or beyond five years', () => {
    expect(etaAt(-2, -0.01, NOW)).toBeNull()
    expect(etaAt(-2, 0.4, NOW)).toBeNull()
    expect(etaAt(-30, -0.06, NOW)).toBeNull()
  })
})
