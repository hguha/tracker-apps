import { describe, expect, it } from 'vitest'
import { volumeDensity, volumeMeasures } from '@/lib/volume'
import {
  GRAMS,
  OUNCES,
  describeLoggable,
  measuresFor,
  readableUnitId,
  startingAmount,
} from '@/features/shared/loggable'
import { testFood } from './fixtures'

const portion = (label: string, grams: number) => ({ id: label, label, grams, isDefault: false })

describe('how much a cup of something weighs', () => {
  it('scales a half-cup portion up to a whole cup', () => {
    const chili = testFood({ description: 'Chili con carne', portions: [portion('1/2 cup', 127)] })
    const cup = volumeMeasures(chili).find((measure) => measure.id === '__cup')!
    expect(cup.grams).toBeCloseTo(254, 0)
    expect(cup.label.startsWith('≈')).toBe(false)
  })

  it('uses a stated density when there is no volume portion', () => {
    const oil = testFood({ description: 'Olive oil', portions: [], gramsPerMl: 0.91 })
    expect(volumeDensity(oil)).toMatchObject({ basis: 'density' })
    expect(volumeMeasures(oil).find((m) => m.id === '__tbsp')!.grams).toBeCloseTo(13.5, 0)
  })

  it('borrows a cup weight, marked as approximate', () => {
    const fries = testFood({ description: 'Parmesan fries', source: 'off', portions: [] })
    const measures = volumeMeasures(fries, [portion('1 cup', 117)])
    expect(measures[0]!.label.startsWith('≈')).toBe(true)
    expect(measures[0]!.grams).toBeCloseTo(117, 0)
  })

  it('treats a named drink as water-dense', () => {
    const juice = testFood({ description: 'Orange juice, not from concentrate', portions: [] })
    expect(volumeDensity(juice)).toMatchObject({ basis: 'liquid', gramsPerMl: 1 })
  })

  it('never invents a cup weight for a solid with no evidence', () => {
    const bar = testFood({ description: 'Protein bar', portions: [portion('1 bar', 60)] })
    expect(volumeMeasures(bar)).toEqual([])
  })
})

describe('the units a food is offered in', () => {
  it('always includes grams and ounces', () => {
    const bare = testFood({ description: 'Mystery crunch', portions: [] })
    const ids = describeLoggable({ kind: 'food', food: bare }).units.map((unit) => unit.id)
    expect(ids).toContain(GRAMS)
    expect(ids).toContain(OUNCES)
  })

  it('does not list a derived cup beside the food’s own one-cup portion', () => {
    const rice = testFood({ description: 'Rice, cooked', portions: [portion('1 cup', 158)] })
    const labels = measuresFor(rice).map((measure) => measure.label)
    expect(labels.filter((label) => /cup/.test(label))).toHaveLength(1)
  })

  it('logs 1.5 cups of chili as the grams it weighs', async () => {
    const chili = testFood({ description: 'Chili con carne', portions: [portion('1/2 cup', 127)] })
    const subject = describeLoggable({ kind: 'food', food: chili })
    const cup = subject.units.find((unit) => unit.id === '__cup')!
    expect(cup.gramsAt(1.5)).toBeCloseTo(381, 0)
  })

  it('opens 381 g of chili as 1.5 cup', () => {
    const chili = testFood({ description: 'Chili con carne', portions: [portion('1/2 cup', 127)] })
    expect(readableUnitId(381, measuresFor(chili))).toBe('__cup')
    const units = describeLoggable({ kind: 'food', food: chili }).units
    expect(startingAmount(units, { grams: 381, portionId: null, portionCount: null })).toEqual({
      unitId: '__cup',
      amount: 1.5,
    })
  })
})
