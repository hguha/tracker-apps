import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { takeEntryChanges } from '@/db/entryChanges'
import * as repo from '@/data/repository'
import { nutritionStats, resetNutritionStatsCache } from '@/data/stats'
import { givenFoods, testFood } from './fixtures'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  localStorage.clear()
  repo.setActiveUserId('local-user')
  resetNutritionStatsCache()
  await givenFoods()
})

async function fresh() {
  resetNutritionStatsCache()
  return nutritionStats()
}

const log = async (day: string, grams = 100) =>
  repo.logFood({ food: testFood(), meal: 'lunch', grams, day })

describe('nutritionStats, kept current a day at a time', () => {
  it('counts what was logged', async () => {
    await log('2026-09-01')
    await log('2026-09-02')
    const stats = await nutritionStats()
    expect(stats).toMatchObject({ daysLogged: 2, entriesLogged: 2, distinctFoods: 1 })
  })

  it('agrees with a full rebuild after logs, edits and deletes', async () => {
    const first = await log('2026-09-01')
    await nutritionStats()

    await log('2026-09-03')
    expect(await nutritionStats()).toEqual(await fresh())

    const row = (await repo.getEntry(first))!
    await repo.updateFoodEntry(first, { amount: { grams: 400 }, meal: row.meal, eatenAt: row.eatenAt })
    expect(await nutritionStats()).toEqual(await fresh())

    await repo.updateFoodEntry(first, {
      amount: { grams: 400 },
      meal: row.meal,
      eatenAt: Date.parse('2026-09-02T12:00:00'),
    })
    expect(await nutritionStats()).toEqual(await fresh())

    await repo.deleteEntry(first)
    const afterDelete = await nutritionStats()
    expect(afterDelete.daysLogged).toBe(1)
    expect(afterDelete).toEqual(await fresh())
  })

  it('follows a row that moved to another day, as a sync pull can do', async () => {
    const id = await log('2026-09-01')
    await nutritionStats()
    const row = (await db.logEntries.get(id))!
    await db.logEntries.bulkPut([{ ...row, day: '2026-09-05', updatedAt: 1 }])

    const stats = await nutritionStats()
    expect(stats.daysLogged).toBe(1)
    expect(stats).toEqual(await fresh())
  })

  it('rebuilds when a change arrived without being seen, as from another tab', async () => {
    await log('2026-09-01')
    await nutritionStats()
    await log('2026-09-02')
    takeEntryChanges()

    expect((await nutritionStats()).daysLogged).toBe(2)
  })

  it('starts over when the table is cleared', async () => {
    await log('2026-09-01')
    await nutritionStats()
    await db.logEntries.clear()

    expect((await nutritionStats()).daysLogged).toBe(0)
  })
})
