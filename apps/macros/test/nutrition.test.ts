import { describe, expect, it } from 'vitest'
import {
  dayTotals,
  gramsToMg,
  nutrientsFor,
  remaining,
  scale,
  macroSharePct,
  proteinPer100Kcal,
  splitTargets,
  sum,
  sumCovered,
  dailyAverageCovered,
} from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type Food, type Nutrients } from '@/domain/types'

function nutrients(over: Partial<Nutrients>): Nutrients {
  return { ...EMPTY_NUTRIENTS, ...over }
}

function food(over: Partial<Food> = {}): Food {
  return {
    id: 'usda:1',
    source: 'usda',
    description: 'Chicken breast, raw',
    brand: null,
    barcode: null,
    category: null,
    dataType: 'foundation',
    per100: nutrients({ kcal: 120, proteinMg: 22_500, carbsMg: 0, fatMg: 2_600, fiberMg: 0 }),
    gramsPerMl: null,
    portions: [{ id: 'p1', label: '1 breast', grams: 174, isDefault: true }],
    verifiedAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
    ...over,
  }
}

describe('nutrientsFor', () => {
  it('scales from the per-100g basis', () => {
    const n = nutrientsFor(food(), 200)
    expect(n.kcal).toBe(240)
    expect(n.proteinMg).toBe(45_000)
  })

  it('holds integer milligrams, so a sum cannot drift', () => {
    // Three 33.3g servings: each rounds, and the total must equal the sum of the rows.
    const parts = [33.3, 33.3, 33.4].map((g) => nutrientsFor(food(), g))
    expect(sum(parts).proteinMg).toBe(parts.reduce((a, p) => a + p.proteinMg, 0))
    expect(Number.isInteger(sum(parts).proteinMg)).toBe(true)
  })
})

describe('sum', () => {
  it('adds core macros', () => {
    const total = sum([nutrients({ kcal: 100, proteinMg: 1000 }), nutrients({ kcal: 50 })])
    expect(total).toMatchObject({ kcal: 150, proteinMg: 1000 })
  })

  it('keeps a micronutrient null unless every row reports it', () => {
    const total = sum([nutrients({ sodiumMg: 400 }), nutrients({ sodiumMg: null })])
    // Summing only the known row would understate the day while looking precise.
    expect(total.sodiumMg).toBeNull()
  })

  it('adds a micronutrient when all rows report it', () => {
    expect(sum([nutrients({ sodiumMg: 400 }), nutrients({ sodiumMg: 100 })]).sodiumMg).toBe(500)
  })

  it('is empty for no items', () => {
    expect(sum([])).toEqual(EMPTY_NUTRIENTS)
  })
})

describe('sumCovered', () => {
  it('reports what was measured instead of erasing the nutrient', () => {
    // The bug this exists for: `sum` is all-or-nothing, which is right for a recipe and wrong for a
    // day. 218 of the 1,463 seeded foods have a gap, so a six-ingredient dish had a ~62% chance of
    // containing one — and that single row erased the nutrient for the whole day. Logging "3 steak
    // tacos" matched an Applebee's sirloin with no fibre figure and the day reported no fibre at all.
    const { totals, coverage } = sumCovered([
      nutrients({ kcal: 900, fiberMg: 4_000 }),
      nutrients({ kcal: 100, fiberMg: null }),
    ])
    expect(totals.fiberMg).toBe(4_000)
    expect(coverage.fiberMg).toBeCloseTo(0.9)
  })

  it('weights coverage by calories, not by rows', () => {
    // A gap on a 600 kcal main course matters; a gap on a squeeze of lime does not, and counting rows
    // would treat the two the same.
    const { coverage } = sumCovered([
      nutrients({ kcal: 5, fiberMg: null }),
      nutrients({ kcal: 5, fiberMg: null }),
      nutrients({ kcal: 590, fiberMg: 6_000 }),
    ])
    expect(coverage.fiberMg).toBeGreaterThan(0.95)
  })

  it('is null only when nothing reported it', () => {
    const { totals, coverage } = sumCovered([
      nutrients({ kcal: 100, ironMg: null }),
      nutrients({ kcal: 100, ironMg: null }),
    ])
    expect(totals.ironMg).toBeNull()
    expect(coverage.ironMg).toBe(0)
  })

  it('counts rows when the day has no calories at all', () => {
    // Otherwise coverage is 0/0 for a day of black coffee and water, and every nutrient reads as
    // unmeasured rather than as measured-and-zero.
    const { coverage } = sumCovered([
      nutrients({ kcal: 0, sodiumMg: 5 }),
      nutrients({ kcal: 0, sodiumMg: null }),
    ])
    expect(coverage.sodiumMg).toBe(0.5)
  })

  it('never lets a gap touch a macro', () => {
    const { totals } = sumCovered([
      nutrients({ kcal: 100, proteinMg: 9_000, fiberMg: null }),
      nutrients({ kcal: 200, proteinMg: 1_000, fiberMg: 500 }),
    ])
    expect(totals).toMatchObject({ kcal: 300, proteinMg: 10_000 })
  })
})

describe('dailyAverageCovered', () => {
  it('divides by logged days and keeps the coverage', () => {
    const rows = [
      { day: '2026-09-01', nutrients: nutrients({ kcal: 1000, fiberMg: 20_000 }) },
      { day: '2026-09-02', nutrients: nutrients({ kcal: 1000, fiberMg: null }) },
    ]
    const { totals, coverage } = dailyAverageCovered(rows)
    expect(totals.kcal).toBe(1000)
    expect(totals.fiberMg).toBe(10_000)
    expect(coverage.fiberMg).toBeCloseTo(0.5)
  })
})

describe('scale', () => {
  it('leaves unknown nutrients unknown', () => {
    expect(scale(nutrients({ kcal: 100, ironMg: null }), 2)).toMatchObject({
      kcal: 200,
      ironMg: null,
    })
  })
})

describe('remaining', () => {
  it('goes negative when over, because that is information', () => {
    const left = remaining(nutrients({ kcal: 2200 }), {
      kcal: 2000,
      proteinMg: 0,
      carbsMg: 0,
      fatMg: 0,
    })
    expect(left.kcal).toBe(-200)
  })
})

describe('splitTargets', () => {
  it('sets protein and fat as floors and gives carbs the remainder', () => {
    const t = splitTargets(2400, 80, 1.8, 25)
    expect(t.proteinMg).toBe(gramsToMg(144))
    expect(t.fatMg).toBe(gramsToMg((0.25 * 2400) / 9))
    expect(t.carbsMg).toBeGreaterThan(0)
  })

  it('never produces negative carbs when the floors exceed the target', () => {
    expect(splitTargets(800, 100, 2.5, 40).carbsMg).toBe(0)
  })
})

describe('dayTotals', () => {
  it('adds the day’s entries', () => {
    expect(dayTotals([{ nutrients: nutrients({ kcal: 500 }) }, { nutrients: nutrients({ kcal: 700 }) }]).kcal).toBe(1200)
  })
})

describe('proteinPer100Kcal', () => {
  it('ranks a lean food above a fatty one', () => {
    const chicken = nutrients({ kcal: 165, proteinMg: 31_000 })
    const oil = nutrients({ kcal: 884, proteinMg: 0 })
    expect(proteinPer100Kcal(chicken)).toBeGreaterThan(proteinPer100Kcal(oil))
  })

  it('is zero rather than Infinity for a zero-calorie row', () => {
    expect(proteinPer100Kcal(nutrients({ kcal: 0, proteinMg: 5_000 }))).toBe(0)
  })
})

describe('macroSharePct', () => {
  it('splits the calories the macros account for', () => {
    const share = macroSharePct(nutrients({ proteinMg: 100_000, carbsMg: 100_000, fatMg: 0 }))
    expect(share.proteinMg).toBeCloseTo(50)
    expect(share.carbsMg).toBeCloseTo(50)
    expect(share.fatMg).toBe(0)
  })

  it('is zero rather than NaN with nothing logged', () => {
    expect(macroSharePct(EMPTY_NUTRIENTS)).toEqual({ proteinMg: 0, carbsMg: 0, fatMg: 0 })
  })
})
