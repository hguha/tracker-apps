import { beforeAll, describe, expect, it } from 'vitest'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { closestGeneric, lendersFrom } from '@/lib/borrowPortions'
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

  it('borrows nothing for a food that has its own cup', async () => {
    const rice = testFood({ portions: [{ id: 'c', label: '1 cup', grams: 158, isDefault: true }] })
    expect(await repo.borrowedPortions(rice)).toBeNull()
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
    const lenders = lendersFrom([branded, broccoli].map((food) => ({ food })))
    expect(closestGeneric(packaged('Seasoned fries'), lenders)).toBeNull()
  })
})

describe('which generic food lends its measures', () => {
  const generic = (id: string, description: string, label = '1 cup') =>
    testFood({
      id,
      dataType: 'Survey (FNDDS)',
      description,
      portions: [{ id: `${id}-p`, label, grams: 120, isDefault: true }],
    })
  const lend = (food: ReturnType<typeof testFood>, ...rows: ReturnType<typeof testFood>[]) =>
    closestGeneric(food, lendersFrom(rows.map((row) => ({ food: row }))))?.from.description ?? null

  it('matches the noun before the first comma, not the last word', () => {
    const butter = packaged('Almond butter, creamy')
    expect(lend(butter, generic('a', 'Egg salad, made with creamy dressing'), generic('b', 'Almond butter'))).toBe(
      'Almond butter',
    )
  })

  it('needs the kind to match when the name leads with a category', () => {
    const naan = packaged('Bread, naan')
    expect(lend(naan, generic('a', 'Bread, French or Vienna'))).toBeNull()
    expect(lend(naan, generic('b', 'Bread, naan, plain'))).toBe('Bread, naan, plain')
  })

  it('ignores a dish’s accompaniments when finding its noun', () => {
    const parm = packaged('Chicken parmesan without cavatappi pasta')
    expect(lend(parm, generic('a', 'Pasta, cooked'))).toBeNull()
  })

  it('never lends a measure that changes density', () => {
    expect(lend(packaged('Bread, rye'), generic('a', 'Bread, rye, toasted', '1 cup, crumbs'))).toBeNull()
  })

  it('reads an all-caps label as a name, not as a restaurant chain', () => {
    const marmalade = packaged('CLEMENTINE ORGANIC MARMALADE, CLEMENTINE')
    expect(lend(marmalade, generic('a', 'Clementine, raw'), generic('b', 'Marmalade, orange'))).toBe(
      'Marmalade, orange',
    )
  })

  it('lends only volume measures to a food that has a serving but no cup', () => {
    const hummus = testFood({
      id: 'off:hummus',
      source: 'off',
      dataType: null,
      description: 'Roasted garlic hummus',
      portions: [{ id: 's', label: '1 serving', grams: 28, isDefault: true }],
    })
    const lender = testFood({
      id: 'usda:h',
      dataType: 'Survey (FNDDS)',
      description: 'Hummus',
      portions: [
        { id: 'h1', label: '1 tablespoon', grams: 15, isDefault: true },
        { id: 'h2', label: '1 small container', grams: 70, isDefault: false },
      ],
    })
    const lent = closestGeneric(hummus, lendersFrom([{ food: lender }]))
    expect(lent?.portions.map((portion) => portion.label)).toEqual(['1 tablespoon'])
  })
})
