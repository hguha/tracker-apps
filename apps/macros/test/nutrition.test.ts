import { describe, expect, it } from 'vitest'
import {
  cycleTargets,
  dayTotals,
  gramsToMg,
  kcalFromMacros,
  macroSplitPct,
  nutrientsFor,
  perServing,
  recipeNutrients,
  remaining,
  scale,
  splitTargets,
  sum,
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

describe('scale', () => {
  it('leaves unknown nutrients unknown', () => {
    expect(scale(nutrients({ kcal: 100, ironMg: null }), 2)).toMatchObject({
      kcal: 200,
      ironMg: null,
    })
  })
})

describe('recipeNutrients', () => {
  const foods = new Map([['usda:1', food()]])

  it('sums matched ingredients', () => {
    const total = recipeNutrients(
      { ingredients: [{ id: 'i1', foodId: 'usda:1', label: 'chicken', grams: 100, optional: false }] },
      foods,
    )
    expect(total.kcal).toBe(120)
  })

  it('contributes nothing for an unmatched ingredient rather than guessing', () => {
    const total = recipeNutrients(
      { ingredients: [{ id: 'i1', foodId: null, label: 'a pinch of magic', grams: 5, optional: false }] },
      foods,
    )
    expect(total.kcal).toBe(0)
  })

  it('skips optional ingredients', () => {
    const total = recipeNutrients(
      { ingredients: [{ id: 'i1', foodId: 'usda:1', label: 'chicken', grams: 100, optional: true }] },
      foods,
    )
    expect(total.kcal).toBe(0)
  })
})

describe('perServing', () => {
  it('divides by servings', () => {
    expect(perServing({ nutrients: nutrients({ kcal: 800 }), servings: 4 }).kcal).toBe(200)
  })

  it('treats zero servings as one instead of dividing by zero', () => {
    expect(perServing({ nutrients: nutrients({ kcal: 800 }), servings: 0 }).kcal).toBe(800)
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

describe('kcalFromMacros / macroSplitPct', () => {
  it('uses 4/4/9', () => {
    expect(kcalFromMacros(nutrients({ proteinMg: 10_000, carbsMg: 10_000, fatMg: 10_000 }))).toBe(170)
  })

  it('splits to roughly 100%', () => {
    const split = macroSplitPct(nutrients({ proteinMg: 150_000, carbsMg: 200_000, fatMg: 70_000 }))
    expect(split.protein + split.carbs + split.fat).toBeGreaterThan(98)
  })

  it('is all zero with no macros, not NaN', () => {
    expect(macroSplitPct(EMPTY_NUTRIENTS)).toEqual({ protein: 0, carbs: 0, fat: 0 })
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

describe('cycleTargets', () => {
  it('redistributes without changing the weekly total', () => {
    const weekly = 7 * 2400
    const days = cycleTargets(weekly, [1.15, 0.9, 1.15, 0.9, 1.15, 0.9, 0.85])
    expect(days.reduce((a, b) => a + b, 0)).toBeCloseTo(weekly, -1)
  })

  it('gives training days more than rest days', () => {
    const days = cycleTargets(7 * 2000, [1.2, 0.8, 1.2, 0.8, 1.2, 0.8, 1])
    expect(days[0]!).toBeGreaterThan(days[1]!)
  })
})

describe('dayTotals', () => {
  it('adds the day’s entries', () => {
    expect(dayTotals([{ nutrients: nutrients({ kcal: 500 }) }, { nutrients: nutrients({ kcal: 700 }) }]).kcal).toBe(1200)
  })
})
