import { describe, expect, it } from 'vitest'
import { reconcile, trendChangePerWeek, weightTrend, type BodyWeight } from '../src/weight'

function w(day: string, kg: number, extra: Partial<BodyWeight> = {}): BodyWeight {
  return { id: day, day, kg, source: 'macros', updatedAt: 1, deletedAt: null, ...extra }
}

describe('reconcile', () => {
  it('keeps one row per day, newest write winning', () => {
    const merged = reconcile(
      [w('2026-09-01', 80, { updatedAt: 10, source: 'macros' })],
      [w('2026-09-01', 81, { updatedAt: 20, source: 'reputation' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ kg: 81, source: 'reputation' })
  })

  it('lets a tombstone win a tie, since deleting is the deliberate act', () => {
    const merged = reconcile(
      [w('2026-09-01', 80, { updatedAt: 10 })],
      [w('2026-09-01', 80, { updatedAt: 10, deletedAt: 99 })],
    )
    expect(merged).toEqual([])
  })

  it('sorts by day across sources', () => {
    const merged = reconcile([w('2026-09-03', 80)], [w('2026-09-01', 81), w('2026-09-02', 82)])
    expect(merged.map((r) => r.day)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })
})

describe('weightTrend', () => {
  it('smooths a spike instead of following it', () => {
    const trend = weightTrend([w('2026-09-01', 80), w('2026-09-02', 80), w('2026-09-03', 84)])
    const last = trend[2]!
    expect(last.kg).toBe(84)
    // Moves toward the spike but nowhere near it: one day at a 10-day half-life is ~6.7%.
    expect(last.trendKg).toBeGreaterThan(80)
    expect(last.trendKg).toBeLessThan(80.5)
  })

  it('decays across a gap rather than holding flat', () => {
    const withGap = weightTrend([w('2026-09-01', 80), w('2026-09-15', 84)])
    const daily = weightTrend([w('2026-09-01', 80), w('2026-09-02', 84)])
    expect(withGap[1]!.trendKg).toBeGreaterThan(daily[1]!.trendKg)
  })

  it('ignores tombstoned weigh-ins', () => {
    expect(weightTrend([w('2026-09-01', 80, { deletedAt: 5 })])).toEqual([])
  })
})

describe('trendChangePerWeek', () => {
  it('reports kg/week over the window', () => {
    // Two weeks of a steady half-kilo-per-week loss.
    const weights = Array.from({ length: 15 }, (_, i) =>
      w(`2026-09-${String(i + 1).padStart(2, '0')}`, 80 - i * (0.5 / 7)),
    )
    const rate = trendChangePerWeek(weightTrend(weights))!
    expect(rate).toBeLessThan(0)
    expect(rate).toBeGreaterThan(-0.5)
  })

  it('says nothing with a single point', () => {
    expect(trendChangePerWeek(weightTrend([w('2026-09-01', 80)]))).toBeNull()
  })
})
