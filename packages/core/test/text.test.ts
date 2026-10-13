import { describe, expect, it } from 'vitest'
import { formatGrams, formatNumber, plural, signed } from '../src/text'

describe('numbers', () => {
  it('groups thousands and rounds to the digits asked for', () => {
    expect(formatNumber(2304)).toBe('2,304')
    expect(formatNumber(2304.6)).toBe('2,305')
    expect(formatNumber(82.46, 1)).toBe('82.5')
  })

  it('writes grams with a space, like every other unit', () => {
    expect(formatGrams(174.4)).toBe('174 g')
    expect(formatGrams(1250)).toBe('1,250 g')
  })
})

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
