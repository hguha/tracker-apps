import { describe, expect, it } from 'vitest'
import { formatMoney, money, parseMoney, sumMoney } from '../src/money'

describe('money', () => {
  it('parses user input into integer minor units', () => {
    expect(parseMoney('1,234.56')).toEqual({ minor: 123456, currency: 'USD' })
    expect(parseMoney('-$45')).toEqual({ minor: -4500, currency: 'USD' })
    expect(parseMoney('  10.005 ')).toEqual({ minor: 1001, currency: 'USD' }) // rounds
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
  })

  it('respects zero-decimal currencies', () => {
    expect(parseMoney('500', 'JPY')).toEqual({ minor: 500, currency: 'JPY' })
  })

  it('formats with sign and currency', () => {
    expect(formatMoney(money(-4500))).toBe('-$45.00')
    expect(formatMoney(money(4500), { signDisplay: 'always' })).toBe('+$45.00')
  })

  it('sums same-currency amounts and rejects a mismatch', () => {
    expect(sumMoney([money(100), money(250)])).toEqual({ minor: 350, currency: 'USD' })
    expect(() => sumMoney([money(100), money(100, 'EUR')])).toThrow(/currency mismatch/)
  })
})
