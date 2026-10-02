import { describe, expect, it } from 'vitest'
import { plural } from '../src/text'

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'day')).toBe('1 day')
    expect(plural(0, 'day')).toBe('0 days')
    expect(plural(2, 'own food')).toBe('2 own foods')
  })
})
