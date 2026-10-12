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
