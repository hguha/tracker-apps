import { describe, expect, it } from 'vitest'
import { householdAmount } from '@/lib/householdAmount'
import { formatQuantity, parseIngredientLine, statedAmount } from '@/lib/parseIngredient'
import { EMPTY_NUTRIENTS, type Food, type FoodPortion } from '@/domain/types'

/**
 * Grams into the measure a cook would use.
 *
 * "363 g of flour" is true and unusable: nobody on imperial units has ever weighed flour. Grams stay
 * canonical everywhere — nothing here feeds arithmetic — so these are all about what gets *shown*.
 */
function food(portions: Partial<FoodPortion>[], gramsPerMl: number | null = null): Food {
  return {
    id: 'usda:1',
    source: 'usda',
    description: 'Test food',
    brand: null,
    barcode: null,
    dataType: 'sr legacy',
    category: null,
    per100: { ...EMPTY_NUTRIENTS, kcal: 100 },
    portions: portions.map((portion, index) => ({
      id: `p${index}`,
      label: portion.label ?? '1 cup',
      grams: portion.grams ?? 100,
      isDefault: portion.isDefault ?? index === 0,
    })),
    gramsPerMl,
    servingGrams: null,
    servingLabel: null,
    verifiedAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
  } as Food
}

describe('householdAmount', () => {
  it('reads a weight back as cups, using the weight measured for that very food', () => {
    // A cup of flour is 120 g and a cup of oil is 218 g, which is why no density table can do this.
    const flour = food([{ label: '1 cup', grams: 120 }])
    expect(householdAmount(360, flour)).toBe('3 cups')
    expect(householdAmount(120, flour)).toBe('1 cup')
    expect(householdAmount(60, flour)).toBe('½ cup')
  })

  it('prefers the largest measure that fits, so flour is cups rather than 24 tablespoons', () => {
    const flour = food([
      { label: '1 cup', grams: 120 },
      { label: '1 tbsp', grams: 7.5 },
    ])
    expect(householdAmount(360, flour)).toBe('3 cups')
    // Below a cup, the spoon is the only one that can express it.
    expect(householdAmount(15, flour)).toBe('2 tbsp')
  })

  it('says nothing rather than something wrong when no rounding is close enough', () => {
    const flour = food([{ label: '1 cup', grams: 120 }])
    // 100 g is 0.83 cups; the nearest quarter is ¾, which is 90 g — a tenth out, which is a rounded
    // tablespoon of flour. Two figures on one row that disagree by that much is worse than one.
    expect(householdAmount(100, flour)).toBeNull()
    // 200 g is 1.75 cups within 5%, which is close enough to be a description of it.
    expect(householdAmount(200, flour)).toBe('1¾ cups')
  })

  it('has nothing to say about a food with no volume portion', () => {
    expect(householdAmount(120, food([{ label: '1 medium', grams: 110 }]))).toBeNull()
    expect(householdAmount(120, null)).toBeNull()
    expect(householdAmount(0, food([{ label: '1 cup', grams: 120 }]))).toBeNull()
  })

  it('ignores a label whose own count is already folded into its weight', () => {
    // "2 cups" stores the weight of two cups, so counting against it would double everything.
    expect(householdAmount(240, food([{ label: '2 cups', grams: 240 }]))).toBeNull()
  })
})

describe('statedAmount', () => {
  it('gives back what the recipe said, spelled as a recipe spells it', () => {
    expect(statedAmount(parseIngredientLine('1/2 cup flour'))).toBe('½ cup')
    expect(statedAmount(parseIngredientLine('2 tablespoons olive oil'))).toBe('2 tbsp')
    expect(statedAmount(parseIngredientLine('1 1/2 cups milk'))).toBe('1½ cups')
    expect(statedAmount(parseIngredientLine('1 lb ground beef'))).toBe('1 lb')
  })

  it('states a bare count with no unit, because the line names the thing it counts', () => {
    expect(statedAmount(parseIngredientLine('9 lasagna noodles'))).toBe('9')
  })

  it('is null when the line states no amount at all', () => {
    expect(statedAmount(parseIngredientLine('salt and pepper to taste'))).toBeNull()
  })
})

describe('formatQuantity', () => {
  it('writes fractions the way they were read', () => {
    expect(formatQuantity(0.5)).toBe('½')
    expect(formatQuantity(1.5)).toBe('1½')
    expect(formatQuantity(1 / 3)).toBe('⅓')
    expect(formatQuantity(3)).toBe('3')
    // Nothing near a written fraction stays a decimal rather than being rounded into a lie.
    expect(formatQuantity(2.4)).toBe('2.4')
  })
})
