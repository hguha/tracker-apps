import * as repo from '@/data/repository'
import { EMPTY_NUTRIENTS, type Food } from '@/domain/types'

/**
 * Foods a test controls, rather than whichever row the seed happens to rank first.
 *
 * The seed is generated (scripts/build-food-seed.mjs), so tests that searched it for "chicken
 * breast" and hardcoded that row's macros broke the moment it grew from 46 foods to 1,416 — not
 * because anything regressed, but because a different, equally correct row now ranks first. A test
 * about the coach's unit conversion should not be able to fail because USDA has more chicken in it.
 */
export function testFood(over: Partial<Food> = {}): Food {
  return {
    id: 'usda:test-chicken',
    source: 'usda',
    description: 'Chicken breast, skinless, raw',
    brand: null,
    barcode: null,
    category: null,
    dataType: 'foundation',
    // Round numbers, so an assertion reads as arithmetic rather than as a lookup: 200 g is
    // 240 kcal and 45 g of protein.
    per100: { ...EMPTY_NUTRIENTS, kcal: 120, proteinMg: 22_500, carbsMg: 0, fatMg: 2_600 },
    gramsPerMl: null,
    portions: [{ id: 'p0', label: '1 breast', grams: 174, isDefault: true }],
    verifiedAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
    ...over,
  }
}

/** Puts the fixture foods in place and returns the first one. */
export async function givenFoods(...foods: Food[]): Promise<Food> {
  const rows = foods.length > 0 ? foods : [testFood()]
  await repo.putFoods(rows)
  return rows[0]!
}
