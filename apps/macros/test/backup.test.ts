import { beforeEach, describe, expect, it } from 'vitest'
import { dayKey } from '@tracker-engine/core'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { exportToCsv } from '@/data/backup'
import { EMPTY_NUTRIENTS } from '@/domain/types'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  await seedFoods()
  repo.setActiveUserId('local-user')
})

describe('exportToCsv', () => {
  it('writes one row per entry, with the food name and grams', async () => {
    const [food] = await repo.searchFoods('chicken breast')
    await repo.logFood({
      food: food!,
      grams: 150,
      meal: 'lunch',
      eatenAt: Date.parse(`${dayKey(Date.now())}T13:05:00`),
    })

    const csv = await exportToCsv()
    const [header, row] = csv.split('\n')
    expect(header).toBe('day,time,meal,item,grams,kcal,protein_g,carbs_g,fat_g,fibre_g,source')
    expect(row).toContain('13:05,lunch,')
    expect(row).toContain('150')
  })

  it('quotes a name containing a comma, so the columns still line up', async () => {
    const id = await repo.saveCustomFood({
      description: 'Wrap, chicken, large',
      per100: { ...EMPTY_NUTRIENTS, kcal: 200, proteinMg: 14_000, carbsMg: 20_000, fatMg: 7_000 },
    })
    await repo.logFood({ food: (await repo.getFood(id))!, grams: 100, meal: 'lunch' })

    const csv = await exportToCsv()
    expect(csv).toContain('"Wrap, chicken, large"')
    expect(csv.split('\n')[1]!.split(',')).toHaveLength(13)
  })

  it('leaves an unrecorded nutrient blank rather than writing 0', async () => {
    await repo.logQuickAdd(
      { ...EMPTY_NUTRIENTS, kcal: 300, proteinMg: 10_000, carbsMg: 30_000, fatMg: 10_000 },
      'snack',
      'Cafeteria mystery',
    )
    const row = (await exportToCsv()).split('\n')[1]!
    expect(row.split(',').at(-2)).toBe('')
  })
})
