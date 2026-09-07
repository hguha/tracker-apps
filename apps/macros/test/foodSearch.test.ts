import { describe, expect, it } from 'vitest'
import { matchesQuery, queryTerms, rankFoods, scoreFood } from '@/lib/foodSearch'
import { EMPTY_NUTRIENTS, type Food, type FoodPortion } from '@/domain/types'

function food(over: Partial<Food> = {}): Food {
  return {
    id: 'f1',
    source: 'usda',
    description: 'Something',
    brand: null,
    barcode: null,
    category: null,
    dataType: 'branded',
    per100: EMPTY_NUTRIENTS,
    gramsPerMl: null,
    portions: [],
    verifiedAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
    ...over,
  }
}

const portion: FoodPortion = { id: 'p', label: '1 sandwich', grams: 200, isDefault: true }

describe('ranking', () => {
  it('puts a composite dish above branded label dumps', () => {
    // The exact failure this exists for: searching "turkey sandwich" surfaced four ALL-CAPS
    // branded rows with no portions ahead of USDA's own composite-dish entry.
    const branded = food({
      id: 'b',
      description: 'TURKEY SANDWICH',
      brand: 'Some Deli',
      dataType: 'branded',
    })
    const dish = food({
      id: 'd',
      description: 'Turkey sandwich on wheat',
      dataType: 'Survey (FNDDS)',
      portions: [portion],
    })

    expect(rankFoods([branded, dish], 'turkey sandwich', 5)[0]?.id).toBe('d')
  })

  it('puts the ingredient above a prepared meal containing it', () => {
    const ingredient = food({
      id: 'i',
      description: 'Chicken, breast, boneless, skinless, raw',
      dataType: 'foundation',
      portions: [portion],
    })
    const dinner = food({
      id: 'm',
      description: 'CHICKEN BREAST MICROWAVE DINNER',
      brand: 'Brand',
      dataType: 'branded',
    })
    expect(rankFoods([dinner, ingredient], 'chicken breast', 5)[0]?.id).toBe('i')
  })

  it('prefers a row that has portions, since the alternative is grams-only', () => {
    const withPortion = food({ id: 'w', description: 'Bagel', portions: [portion] })
    const without = food({ id: 'n', description: 'Bagel' })
    expect(scoreFood(withPortion, 'bagel')).toBeGreaterThan(scoreFood(without, 'bagel'))
  })

  it('rewards a description that starts with the query', () => {
    const starts = food({ id: 's', description: 'Apple, raw' })
    const buried = food({ id: 'b', description: 'Pie, apple, commercially prepared' })
    expect(rankFoods([buried, starts], 'apple', 5)[0]?.id).toBe('s')
  })

  it('is stable for equal scores, so results do not shuffle between keystrokes', () => {
    const a = food({ id: 'a', description: 'Aaa food' })
    const b = food({ id: 'b', description: 'Bbb food' })
    expect(rankFoods([b, a], 'food', 5).map((f) => f.id)).toEqual(['a', 'b'])
    expect(rankFoods([a, b], 'food', 5).map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => food({ id: `f${i}`, description: `Food ${i}` }))
    expect(rankFoods(many, 'food', 8)).toHaveLength(8)
  })

  it('does not penalise a short all-caps name as shouting', () => {
    // "EGG" is three letters; treating it as a branded label dump would be wrong.
    expect(scoreFood(food({ description: 'EGG' }), 'egg')).toBeGreaterThan(
      scoreFood(food({ description: 'EGG NOODLE ENTREE DINNER' }), 'egg'),
    )
  })
})

describe('matching', () => {
  it('matches terms in any order', () => {
    const dish = food({ description: 'Turkey sandwich on wheat' })
    expect(matchesQuery(dish, queryTerms('wheat turkey'))).toBe(true)
  })

  it('requires every term', () => {
    const dish = food({ description: 'Turkey sandwich on wheat' })
    expect(matchesQuery(dish, queryTerms('turkey rye'))).toBe(false)
  })

  it('searches the brand as well as the description', () => {
    expect(matchesQuery(food({ description: 'Corn Flakes', brand: 'Kellogg' }), queryTerms('kellogg'))).toBe(true)
  })
})
