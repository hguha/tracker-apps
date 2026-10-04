import { describe, expect, it } from 'vitest'
import { ingredientHead, ingredientQueries, namesIngredient } from '@/lib/ingredientMatch'
import { testFood } from './fixtures'

const named = (description: string, query: string) =>
  namesIngredient(testFood({ description }), query)

describe('which word of an ingredient names it', () => {
  it('is the last word of the name, before any "with"', () => {
    expect(ingredientHead('vanilla icing')).toBe('icing')
    expect(ingredientHead('banana bread with chocolate chips')).toBe('bread')
    expect(ingredientHead('chicken breast, grilled')).toBe('breast')
  })

  it('skips the cut or the piece, which is not the food', () => {
    expect(ingredientHead('garlic cloves')).toBe('garlic')
    expect(ingredientHead('salmon fillet')).toBe('salmon')
  })
})

describe('a match has to be the thing, not something that mentions it', () => {
  it('turns down a food that only shares a flavour with the ingredient', () => {
    expect(named('Ice cream, vanilla', 'vanilla icing')).toBe(false)
    expect(named('Milk shake, vanilla, fast food', 'vanilla icing')).toBe(false)
    expect(named('Cream cheese, full fat, block', 'cream cheese icing')).toBe(false)
  })

  it('turns down a food that only comes with it', () => {
    expect(named('Cookie, brownie, NS as to icing', 'icing')).toBe(false)
    expect(named('Pillsbury, Cinnamon Rolls with Icing, refrigerated dough', 'icing')).toBe(false)
    expect(named('Cake, yellow, commercially prepared, with vanilla frosting', 'vanilla frosting')).toBe(false)
    expect(named('Cheese, parmesan, grated', 'parmesan fries')).toBe(false)
  })

  it('accepts the database’s way of naming the same food', () => {
    expect(named('Frostings, vanilla, creamy, ready-to-eat', 'vanilla icing')).toBe(true)
    expect(named('Icing, white', 'icing')).toBe(true)
    expect(named('Bread, banana, prepared from recipe, made with margarine', 'banana bread')).toBe(true)
    expect(named('Chicken, broilers or fryers, breast, meat only, cooked', 'chicken breast')).toBe(true)
    expect(named('Potato, french fries, from fresh, fried', 'parmesan fries')).toBe(true)
    expect(named('Cookies, chocolate chip', 'cookie')).toBe(true)
    expect(named('Garlic, raw', 'garlic cloves')).toBe(true)
  })
})

describe('what to search when the name as written finds nothing', () => {
  it('tries the synonym, then the food on its own', () => {
    expect(ingredientQueries('vanilla icing')).toEqual([
      'vanilla icing',
      'vanilla frosting',
      'icing',
      'frosting',
    ])
    expect(ingredientQueries('banana')).toEqual(['banana'])
  })
})
