// The canonical calc layer, tested from day one (calc-consistency, principle #7).

import { describe, expect, it } from 'vitest'
import {
  detectRecurring,
  monthlyCashflow,
  netWorthMinor,
  savingsRate,
  spendingByCategory,
} from '@/metrics'
import { SEED_ACCOUNTS, SEED_TRANSACTIONS } from '@/seed'

describe('ledger metrics', () => {
  it('net worth sums account balances (credit card negative)', () => {
    // 342_512 checking + (-87_340) card
    expect(netWorthMinor(SEED_ACCOUNTS)).toBe(342_512 - 87_340)
  })

  it('spending by category is outflow-only, biggest first', () => {
    const rows = spendingByCategory(SEED_TRANSACTIONS)
    // Income is excluded; everything returned is negative.
    expect(rows.every((r) => r.totalMinor < 0)).toBe(true)
    expect(rows.some((r) => r.categoryId === 'cat_income')).toBe(false)
    // Sorted most-negative (biggest spend) first.
    expect(rows[0]!.totalMinor).toBeLessThanOrEqual(rows[rows.length - 1]!.totalMinor)
    // Dining = Sweetgreen + Ramen + Blue Bottle.
    const dining = rows.find((r) => r.categoryId === 'cat_dining')
    expect(dining?.totalMinor).toBe(-3_215 - 4_780 - 2_950)
  })

  it('monthly cash flow buckets income vs spend by month', () => {
    const months = monthlyCashflow(SEED_TRANSACTIONS)
    const aug = months.find((m) => m.month === '2026-08')
    expect(aug?.incomeMinor).toBe(480_000)
    expect(aug?.netMinor).toBe(aug!.incomeMinor + aug!.spendMinor)
    // June only has the Netflix charge (no income) → negative net.
    expect(months.find((m) => m.month === '2026-06')?.netMinor).toBe(-1_599)
  })

  it('savings rate is (income - spend) / income, clamped to 0', () => {
    const rate = savingsRate(SEED_TRANSACTIONS)
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(1)
    expect(savingsRate([])).toBe(0)
  })

  it('detects Netflix + Spotify as monthly recurring, not one-off merchants', () => {
    const rec = detectRecurring(SEED_TRANSACTIONS)
    const merchants = rec.map((r) => r.merchant)
    expect(merchants).toContain('Netflix')
    expect(merchants).toContain('Spotify')
    // One-off merchants are not recurring.
    expect(merchants).not.toContain('Uniqlo')
    expect(merchants).not.toContain('Sweetgreen')

    const netflix = rec.find((r) => r.merchant === 'Netflix')!
    expect(netflix.count).toBe(3)
    expect(netflix.avgAmountMinor).toBe(-1_599)
    expect(netflix.cadence).toBe('monthly')
  })
})
