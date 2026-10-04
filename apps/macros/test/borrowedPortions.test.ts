import { beforeAll, describe, expect, it } from 'vitest'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { closestGeneric } from '@/lib/borrowPortions'
import { testFood } from './fixtures'

beforeAll(async () => {
  await seedFoods()
})

const packaged = (description: string) =>
  testFood({ id: `off:${description}`, source: 'off', dataType: null, description, portions: [] })

describe('borrowing a measure for a food that has none', () => {
  it('gives packaged parmesan fries the portions of generic french fries', async () => {
    const borrowed = await repo.borrowedPortions(packaged('Garlic & Herb Parmesan Fries'))
    expect(borrowed).not.toBeNull()
    expect(borrowed!.from.description).toMatch(/^Potato, french fries/)
    expect(borrowed!.portions.map((portion) => portion.label)).toContain('1 cup')
    expect(borrowed!.portions.some((portion) => /yields|waffle|NS as to/.test(portion.label))).toBe(false)
  })

  it('does not lend a restaurant’s portion as if it were generic', async () => {
    const borrowed = await repo.borrowedPortions(packaged('Seasoned fries'))
    expect(borrowed!.from.description).not.toMatch(/^[A-Z'’]+,/)
  })

  it('borrows nothing for a food that already has a household measure', async () => {
    expect(await repo.borrowedPortions(testFood())).toBeNull()
  })

  it('borrows nothing when no generic food shares the head noun', async () => {
    expect(await repo.borrowedPortions(packaged('Zorblax crunch qwertyuiop'))).toBeNull()
  })

  it('never borrows from a branded row, nor from fried things that are not fries', () => {
    const portions = [{ id: 'p', label: '1 cup', grams: 100, isDefault: true }]
    const branded = testFood({ id: 'usda:b', dataType: 'Branded', description: 'FRIES', portions })
    const broccoli = testFood({
      id: 'usda:c',
      dataType: 'Survey (FNDDS)',
      description: 'Fried broccoli',
      portions,
    })
    expect(closestGeneric(packaged('Seasoned fries'), [branded, broccoli])).toBeNull()
  })
})
