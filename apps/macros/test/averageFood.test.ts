import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { averageFood } from '@/lib/averageFood'
import { EMPTY_NUTRIENTS } from '@/domain/types'
import { testFood } from './fixtures'

const alfredo = (id: string, description: string, kcal: number, brand: string | null = null) =>
  testFood({
    id,
    description,
    brand,
    per100: { ...EMPTY_NUTRIENTS, kcal, proteinMg: kcal * 50, fiberMg: null },
    portions: [
      { id: `${id}-c`, label: '1 cup', grams: 240, isDefault: true },
    ],
  })

const sources = [
  alfredo('usda:a', 'Chicken alfredo, NFS', 160),
  alfredo('usda:b', 'Chicken fettuccine alfredo', 140),
  alfredo('off:c', 'Chicken alfredo bowl', 180, 'Lean Cuisine'),
  alfredo('off:d', 'Chicken alfredo', 900, 'Typo Foods'),
  alfredo('usda:e', 'Alfredo sauce with poultry', 150),
  alfredo('usda:f', 'Chicken breast, raw', 120),
]

describe('an average of everything sold under one name', () => {
  it('takes the middle of the sources that are the dish, so one bad label cannot drag it', () => {
    const average = averageFood('chicken alfredo', sources)!
    expect(average.brand).toBe('Average of 4')
    expect(average.per100.kcal).toBe(170)
    expect(average.per100.fiberMg).toBeNull()
    expect(average.portions.map((portion) => portion.label)).toEqual(['1 serving', '1 cup'])
    expect(average.portions[0]!.grams).toBe(240)
  })

  it('needs three sources before it is worth showing', () => {
    expect(averageFood('chicken alfredo', sources.slice(0, 2))).toBeNull()
  })
})

describe('logging an average', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.filter((table) => table.name !== 'foods').map((t) => t.clear()))
    repo.setActiveUserId('local-user')
  })

  it('keeps it as one food of yours, updated rather than duplicated', async () => {
    const average = averageFood('chicken alfredo', sources)!
    await repo.logFood({ food: average, meal: 'dinner' })
    await repo.logFood({ food: average, meal: 'dinner' })

    const own = await repo.customFoods()
    expect(own).toHaveLength(1)
    expect(own[0]!.description).toBe('Chicken alfredo')
    const rows = await repo.allEntries()
    expect(rows.map((row) => row.foodId)).toEqual([own[0]!.id, own[0]!.id])
    expect(rows[0]!.grams).toBe(240)
  })

  it('keeps the numbers it was first logged with, so recipes using it do not shift', async () => {
    const first = averageFood('chicken alfredo', sources)!
    await repo.logFood({ food: first, meal: 'dinner' })
    const later = averageFood('chicken alfredo', [
      ...sources,
      alfredo('off:g', 'Chicken alfredo', 400, 'Big Portions'),
      alfredo('off:h', 'Chicken alfredo', 400, 'Bigger Portions'),
    ])!
    expect(later.per100.kcal).not.toBe(first.per100.kcal)
    await repo.logFood({ food: later, meal: 'dinner' })

    const [own] = await repo.customFoods()
    expect(own!.per100.kcal).toBe(first.per100.kcal)
  })
})
