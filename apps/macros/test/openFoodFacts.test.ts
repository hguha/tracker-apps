import { describe, expect, it } from 'vitest'
import { mapOffProduct, mapOffSearch, type OffProduct } from '@/lib/openFoodFacts'

function product(over: Partial<OffProduct> = {}): OffProduct {
  return {
    code: '0038000138416',
    product_name: 'Corn Flakes',
    brands: 'Kellogg’s, Kelloggs',
    categories: 'Breakfast cereals, Cereals',
    nutriments: {
      'energy-kcal_100g': 357,
      proteins_100g: 7.1,
      carbohydrates_100g: 84,
      fat_100g: 0.9,
    },
    ...over,
  }
}

describe('mapOffProduct', () => {
  it('converts grams to integer milligrams', () => {
    const food = mapOffProduct(product())!
    expect(food.per100.proteinMg).toBe(7100)
    expect(food.per100.carbsMg).toBe(84_000)
    expect(food.per100.kcal).toBe(357)
  })

  it('reads sodium as grams, not milligrams', () => {
    // OFF states sodium in g/100g; copying it straight through would be 1000x out.
    const food = mapOffProduct(
      product({ nutriments: { ...product().nutriments, sodium_100g: 0.66 } }),
    )!
    expect(food.per100.sodiumMg).toBe(660)
  })

  it('leaves an unstated nutrient null rather than zero', () => {
    const food = mapOffProduct(product())!
    expect(food.per100.fiberMg).toBeNull()
    expect(food.per100.sodiumMg).toBeNull()
  })

  it('parses numbers given as strings', () => {
    const food = mapOffProduct(
      product({ nutriments: { ...product().nutriments, fiber_100g: '3.5' } }),
    )!
    expect(food.per100.fiberMg).toBe(3500)
  })

  it('treats an empty string as unstated', () => {
    const food = mapOffProduct(
      product({ nutriments: { ...product().nutriments, fiber_100g: '' } }),
    )!
    expect(food.per100.fiberMg).toBeNull()
  })

  it('rejects a product missing any of the four macros', () => {
    expect(
      mapOffProduct(product({ nutriments: { 'energy-kcal_100g': 357, proteins_100g: 7.1 } })),
    ).toBeNull()
  })

  it('rejects a product with no name', () => {
    expect(mapOffProduct(product({ product_name: '  ' }))).toBeNull()
  })

  it('keeps only the first brand', () => {
    expect(mapOffProduct(product())!.brand).toBe('Kellogg’s')
  })

  it('ids by barcode so a rescan hits the cache', () => {
    expect(mapOffProduct(product())!.id).toBe('off:0038000138416')
  })

  it('adds a serving portion when a serving mass is stated', () => {
    const food = mapOffProduct(product({ serving_quantity: 30, serving_size: '30 g (1 cup)' }))!
    expect(food.portions).toEqual([
      { id: 'off-serving', label: '30 g (1 cup)', grams: 30, isDefault: true },
    ])
  })

  it('adds no portion when the serving mass is missing or zero', () => {
    expect(mapOffProduct(product())!.portions).toEqual([])
    expect(mapOffProduct(product({ serving_quantity: 0 }))!.portions).toEqual([])
  })

  it('never marks crowd-sourced data verified', () => {
    expect(mapOffProduct(product())!.verifiedAt).toBeNull()
    expect(mapOffProduct(product())!.source).toBe('off')
  })
})

describe('mapOffSearch', () => {
  it('keeps the loggable products and drops the rest', () => {
    const products = [
      { code: '1', product_name: 'Complete bar', nutriments: { 'energy-kcal_100g': 400, proteins_100g: 20, carbohydrates_100g: 40, fat_100g: 15 } },
      // No macros: a row like this can't be logged honestly, so it must not reach the list.
      { code: '2', product_name: 'Mystery drink', nutriments: {} },
      // No name: nothing to show the user.
      { code: '3', nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 } },
    ]
    const mapped = mapOffSearch(products)
    expect(mapped).toHaveLength(1)
    expect(mapped[0]!.description).toBe('Complete bar')
  })
})
