import { describe, expect, it } from 'vitest'
import { goalProgress } from '@/lib/goal'

const NOW = Date.parse('2026-09-09T12:00:00')
const WEEKS = (ms: number) => ms / (7 * 86_400_000)

describe('goalProgress', () => {
  const losing = {
    goal: 'lose' as const,
    targetKg: 75,
    startKg: 85,
    trendKg: 80,
    ratePctPerWeek: -0.5,
    now: NOW,
  }

  it('reports the fraction of the way from where the goal was set', () => {
    expect(goalProgress({ ...losing, ratePerWeek: -0.4 }).fraction).toBeCloseTo(0.5, 3)
  })

  it('dates the goal off the measured rate, not the plan', () => {
    // 5 kg to go at 0.4 kg/week is 12.5 weeks. The plan's 0.5%/week of 80 kg is only 0.4 kg in
    // week one and less after, so the planned date is *later* — and both are reported.
    const measured = goalProgress({ ...losing, ratePerWeek: -0.4 })
    expect(WEEKS(measured.etaAt! - NOW)).toBeCloseTo(12.5, 1)
    expect(measured.plannedEtaAt).not.toBeNull()
    expect(measured.plannedEtaAt!).toBeGreaterThan(measured.etaAt!)
  })

  it('gives no date at all when the trend is flat', () => {
    const flat = goalProgress({ ...losing, ratePerWeek: 0.01 })
    expect(flat.etaAt).toBeNull()
    expect(flat.isWrongWay).toBe(false)
    // The plan still has one, which is the honest way to say "not yet, but here's the intent".
    expect(flat.plannedEtaAt).not.toBeNull()
  })

  it('says so plainly when the trend is going the wrong way', () => {
    const gaining = goalProgress({ ...losing, ratePerWeek: 0.3 })
    expect(gaining.isWrongWay).toBe(true)
    expect(gaining.etaAt).toBeNull()
  })

  it('knows when a losing goal is met, and a gaining one', () => {
    expect(goalProgress({ ...losing, trendKg: 74.8, ratePerWeek: -0.4 }).isReached).toBe(true)
    expect(goalProgress({ ...losing, trendKg: 75.2, ratePerWeek: -0.4 }).isReached).toBe(false)
    expect(
      goalProgress({
        goal: 'gain',
        targetKg: 85,
        startKg: 80,
        trendKg: 85.1,
        ratePerWeek: 0.2,
        ratePctPerWeek: 0.25,
        now: NOW,
      }).isReached,
    ).toBe(true)
  })

  it('never reports a maintain program as reached, because there is nothing to reach', () => {
    const holding = goalProgress({
      goal: 'maintain',
      targetKg: 80,
      startKg: 80,
      trendKg: 80,
      ratePerWeek: 0,
      ratePctPerWeek: 0,
      now: NOW,
    })
    expect(holding.isReached).toBe(false)
    expect(holding.plannedEtaAt).toBeNull()
  })

  it('has no fraction without a start weight, rather than inventing one', () => {
    expect(goalProgress({ ...losing, startKg: null, ratePerWeek: -0.4 }).fraction).toBeNull()
  })

  it('reports remaining as signed, so past-the-target reads as past', () => {
    expect(goalProgress({ ...losing, trendKg: 74, ratePerWeek: -0.4 }).remainingKg).toBeCloseTo(-1)
  })

  it('refuses a date more than five years out rather than showing one', () => {
    const glacial = goalProgress({ ...losing, ratePctPerWeek: -0.001, ratePerWeek: null })
    expect(glacial.plannedEtaAt).toBeNull()
  })
})
