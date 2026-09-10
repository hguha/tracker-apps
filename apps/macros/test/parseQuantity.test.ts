import { describe, expect, it } from 'vitest'
import { parseQuantity } from '@/lib/parseQuantity'

describe('parseQuantity', () => {
  it('splits the count off the thing', () => {
    expect(parseQuantity('3 steak tacos')).toEqual({ count: 3, unit: 'steak taco' })
    expect(parseQuantity('two chicken wraps')).toEqual({ count: 2, unit: 'chicken wrap' })
    expect(parseQuantity('4 chocolate zucchini muffins')).toEqual({
      count: 4,
      unit: 'chocolate zucchini muffin',
    })
  })

  it('handles the plurals English actually uses', () => {
    expect(parseQuantity('2 sandwiches')?.unit).toBe('sandwich')
    expect(parseQuantity('3 brownies')?.unit).toBe('brownie')
    expect(parseQuantity('6 blueberry pancakes')?.unit).toBe('blueberry pancake')
  })

  it('leaves alone the words that only exist in the plural', () => {
    // A stemmer would offer to save "1 chip" and "1 hummu".
    expect(parseQuantity('2 servings of hummus')).toBeNull()
    expect(parseQuantity('3 bags of chips')).toBeNull()
    expect(parseQuantity('2 fries')?.unit).toBe('fries')
  })

  it('declines a count of one, which has nothing to divide', () => {
    expect(parseQuantity('1 steak taco')).toBeNull()
    expect(parseQuantity('a burrito')).toBeNull()
  })

  it('declines a container or a weight, because the number is not a count of the food', () => {
    // "3 bowls of soup" is one soup; dividing its macros by three would be wrong.
    expect(parseQuantity('3 bowls of soup')).toBeNull()
    expect(parseQuantity('2 cups of rice')).toBeNull()
    expect(parseQuantity('200 g chicken breast')).toBeNull()
    expect(parseQuantity('12 oz steak')).toBeNull()
  })

  it('declines anything it cannot read as a count of items', () => {
    expect(parseQuantity('steak tacos')).toBeNull()
    expect(parseQuantity('1.5 burritos')).toBeNull()
    expect(parseQuantity('2 1/2 pancakes')).toBeNull()
    expect(parseQuantity('2026 calories')).toBeNull()
    expect(parseQuantity('')).toBeNull()
  })
})
