import { describe, expect, it } from 'vitest'
import { DAY_MS, WEEK_MS, dayKey } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend, type BodyWeight, type TrendPoint } from '@tracker-engine/body'
import {
  blendRates,
  eatingRate,
  etaAt,
  goalForecast,
  goalProgress,
  rateForKcal,
  scaleRate,
} from '@/lib/goal'
import { estimateInitialExpenditure, targetKcal } from '@/lib/expenditure'

const NOW = Date.parse('2026-10-04T12:00:00')
const weeksFromNow = (at: number | null) => (at === null ? null : (at - NOW) / WEEK_MS)
const LB = 0.45359237
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

function intakeDays(kcal: number, days = 14, swing = 150) {
  return Array.from({ length: days }, (_, i) => ({
    day: dayKey(NOW - (days - i) * DAY_MS),
    kcal: kcal + ((i % 3) - 1) * swing,
  }))
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

describe('eatingRate', () => {
  const expenditure = { kcal: 2500, se: 100 }

  it('prices the gap between intake and expenditure as weight per week', () => {
    const rate = eatingRate({ intake: intakeDays(2000, 14, 0), expenditure, energyPerKg: 7700 })!
    expect(rate.kgPerWeek).toBeCloseTo((-500 * 7) / 7700, 4)
    expect(rate.meanIntakeKcal).toBe(2000)
    expect(rate.days).toBe(14)
  })

  it('counts logged days only, and needs three of them', () => {
    const intake = [...intakeDays(2000, 2, 0), { day: '2026-10-01', kcal: 0 }]
    expect(eatingRate({ intake, expenditure, energyPerKg: 7700 })).toBeNull()
  })

  it('has nothing to say without an expenditure estimate', () => {
    expect(eatingRate({ intake: intakeDays(2000), expenditure: null, energyPerKg: 7700 })).toBeNull()
  })

  it('is less certain on a cold-start guess than on a measured expenditure', () => {
    const intake = intakeDays(2000)
    const measured = eatingRate({ intake, expenditure, energyPerKg: 7700 })!
    const guessed = eatingRate({ intake, expenditure: { kcal: 2500, se: 400 }, energyPerKg: 7700 })!
    expect(guessed.se).toBeGreaterThan(measured.se)
  })
})

describe('blendRates', () => {
  it('weights each source by how much it can be trusted', () => {
    const blended = blendRates({ kgPerWeek: -1, se: 0.1 }, { kgPerWeek: -0.5, se: 0.3 })!
    expect(blended.scaleWeight).toBeCloseTo(0.9, 2)
    expect(blended.kgPerWeek).toBeCloseTo(-0.95, 2)
    expect(blended.se).toBeLessThan(0.1)
  })

  it('falls back to whichever source exists', () => {
    expect(blendRates(null, { kgPerWeek: -0.5, se: 0.3 })!.scaleWeight).toBe(0)
    expect(blendRates({ kgPerWeek: -0.5, se: 0.3 }, null)!.scaleWeight).toBe(1)
    expect(blendRates(null, null)).toBeNull()
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

describe('rateForKcal', () => {
  it('turns a daily calorie figure into the rate it implies', () => {
    expect(rateForKcal(2000, { kcal: 2770, se: 100 }, 7700)).toBeCloseTo(-0.7, 3)
    expect(rateForKcal(2000, null, 7700)).toBeNull()
  })
})

describe('goalForecast', () => {
  const startKg = 180 * LB
  const targetKg = 175 * LB
  const expenditure = estimateInitialExpenditure({
    kg: startKg,
    heightCm: 178,
    age: 32,
    sex: 'male',
    activity: 'moderate',
  })
  const fastKcal = targetKcal(expenditure, { goal: 'lose', ratePctPerWeek: -0.75 }, startKg)

  const forecastFor = (trend: TrendPoint[], over: Partial<Parameters<typeof goalForecast>[0]> = {}) =>
    goalForecast({
      goal: 'lose',
      targetKg,
      trend,
      intake: intakeDays(fastKcal),
      expenditure,
      energyPerKg: 7700,
      targetKcal: fastKcal,
      isCustomTarget: false,
      ratePctPerWeek: -0.75,
      now: NOW,
      ...over,
    })!

  it('puts 5 lb at Fast pace weeks away, not months, for someone eating on target', () => {
    const trend = weightTrend(weighIns(startKg, { flatDays: 120, days: 21, kgPerWeek: -0.61 }))
    const since = NOW - 22 * DAY_MS
    const forecast = forecastFor(trend, { behaviourSince: since })

    expect(weeksFromNow(forecast.likely!.etaAt)!).toBeLessThan(4)
    expect(weeksFromNow(forecast.onTarget!.etaAt)!).toBeLessThan(4)
    expect(forecast.pace).toBe('matches')

    const oldRate = trendChangePerWeek(trend)!
    expect(-forecast.neededKg / -oldRate).toBeGreaterThan(20)
  })

  it('leans on the food log early, and on the scale once it has weeks of data', () => {
    const early = forecastFor(weightTrend(weighIns(startKg, { days: 6, kgPerWeek: -0.61 })))
    const settled = forecastFor(weightTrend(weighIns(startKg, { days: 28, kgPerWeek: -0.61 })))
    expect(early.likely!.scaleWeight).toBeLessThan(0.3)
    expect(settled.likely!.scaleWeight).toBeGreaterThan(0.7)
  })

  it('moves the likely date later when eating above target', () => {
    const trend = weightTrend(weighIns(startKg, { days: 6, kgPerWeek: -0.61 }))
    const onPlan = forecastFor(trend)
    const over = forecastFor(trend, { intake: intakeDays(fastKcal + 500) })
    expect(over.likely!.etaAt!).toBeGreaterThan(onPlan.likely!.etaAt!)
    expect(over.eating!.meanIntakeKcal - onPlan.eating!.meanIntakeKcal).toBe(500)
  })

  it('gives a range that brackets the likely date', () => {
    const forecast = forecastFor(weightTrend(weighIns(startKg, { days: 14, kgPerWeek: -0.61 })))
    const { earliestAt, etaAt: at, latestAt } = forecast.likely!
    expect(earliestAt!).toBeLessThan(at!)
    expect(latestAt!).toBeGreaterThan(at!)
  })

  it('says when the trend is heading away from the goal', () => {
    const forecast = forecastFor(weightTrend(weighIns(startKg, { days: 28, kgPerWeek: 0.5 })), {
      intake: intakeDays(expenditure.kcal + 600),
    })
    expect(forecast.isWrongWay).toBe(true)
    expect(forecast.likely!.etaAt).toBeNull()
  })

  it('flags a target that implies a different pace from the one chosen', () => {
    const trend = weightTrend(weighIns(startKg, { days: 10, kgPerWeek: -0.3 }))
    const steadyKcal = targetKcal(expenditure, { goal: 'lose', ratePctPerWeek: -0.5 }, startKg)
    expect(forecastFor(trend, { targetKcal: steadyKcal + 150 }).pace).toBe('off-pace')
    expect(forecastFor(trend, { targetKcal: fastKcal + 40 }).pace).toBe('matches')
  })

  it('says custom targets are in charge whenever they are on', () => {
    const trend = weightTrend(weighIns(startKg, { days: 10, kgPerWeek: -0.3 }))
    expect(forecastFor(trend, { isCustomTarget: true }).pace).toBe('custom')
  })

  it('still dates the chosen pace with nothing measured yet', () => {
    const trend = weightTrend(weighIns(startKg, { days: 1, kgPerWeek: 0 }))
    const forecast = forecastFor(trend, { intake: [], expenditure: null, targetKcal: null })
    expect(forecast.likely).toBeNull()
    expect(forecast.onTarget).toBeNull()
    expect(weeksFromNow(forecast.chosen.etaAt)).toBeCloseTo(-forecast.neededKg / (0.0075 * startKg), 1)
  })

  it('returns nothing without a single weigh-in', () => {
    expect(
      goalForecast({
        goal: 'lose',
        targetKg,
        trend: [],
        intake: [],
        expenditure: null,
        energyPerKg: 7700,
        targetKcal: null,
        isCustomTarget: false,
        ratePctPerWeek: -0.75,
        now: NOW,
      }),
    ).toBeNull()
  })
})
