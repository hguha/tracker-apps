import { beforeEach, describe, expect, it } from 'vitest'
import { DAY_MS } from '@tracker-engine/core'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'

const NOW = Date.parse('2026-10-04T08:00:00')

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

describe('bodyweightTrend', () => {
  it('is empty with no weigh-ins', async () => {
    expect(await repo.bodyweightTrend(NOW)).toEqual({ trend: [], kgPerWeek: null })
  })

  it('smooths one reading a day, the last of the day winning, and measures the weekly rate', async () => {
    for (let day = 0; day < 15; day += 1) {
      await repo.addMetricEntry({
        definitionId: 'bodyweight',
        value: 80 - day * 0.1,
        measuredAt: NOW - (14 - day) * DAY_MS,
      })
    }
    await repo.addMetricEntry({ definitionId: 'bodyweight', value: 78.4, measuredAt: NOW + 3_600_000 })

    const { trend, kgPerWeek } = await repo.bodyweightTrend(NOW + 7_200_000)
    expect(trend).toHaveLength(15)
    expect(trend[trend.length - 1]!.kg).toBe(78.4)
    expect(trend[trend.length - 1]!.trendKg).toBeGreaterThan(78.4)
    expect(kgPerWeek!).toBeCloseTo(-0.7, 0)
  })
})

describe('goal weight', () => {
  async function weighDaily(fromKg: number, kgPerDay: number, days = 15) {
    for (let day = 0; day < days; day += 1) {
      await repo.addMetricEntry({
        definitionId: 'bodyweight',
        value: fromKg + day * kgPerDay,
        measuredAt: NOW - (days - 1 - day) * DAY_MS,
      })
    }
  }

  it('has no outlook until a goal is set', async () => {
    await weighDaily(80, -0.1)
    expect(await repo.bodyGoalOutlook(NOW)).toBeNull()
  })

  it('records where the goal was set from and forecasts toward it', async () => {
    await weighDaily(80, -0.1)
    await repo.setGoalWeight(75, NOW)

    const profile = await repo.getProfile()
    expect(profile.goalWeightKg).toBe(75)
    expect(profile.goalStartKg).toBeGreaterThan(78)

    const outlook = await repo.bodyGoalOutlook(NOW)
    expect(outlook?.goal).toBe('lose')
    expect(outlook?.likelyAt).not.toBeNull()
  })

  it('clears both the goal and its starting point', async () => {
    await weighDaily(80, -0.1)
    await repo.setGoalWeight(75, NOW)
    await repo.setGoalWeight(null, NOW)
    const profile = await repo.getProfile()
    expect([profile.goalWeightKg, profile.goalStartKg]).toEqual([null, null])
  })
})
