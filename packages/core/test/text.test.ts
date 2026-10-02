import { describe, expect, it } from 'vitest'
import { plural, signed } from '../src/text'

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'day')).toBe('1 day')
    expect(plural(0, 'day')).toBe('0 days')
    expect(plural(2, 'own food')).toBe('2 own foods')
  })
})

describe('signed', () => {
  it('marks gains and zero with a plus, at the requested precision', () => {
    expect(signed(0.25, 2)).toBe('+0.25')
    expect(signed(0)).toBe('+0')
    expect(signed(-1.26, 1)).toBe('-1.3')
  })
})
