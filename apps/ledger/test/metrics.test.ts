// The canonical calc layer, tested from day one (calc-consistency, principle #7).
// Metrics run on the unified LedgerEntry model, so build entries from the bank seed.

import { describe, expect, it } from 'vitest'
import {
  detectRecurring,
  monthlyCashflow,
  netWorthMinor,
  savingsRate,
  spendingByCategory,
  totals,
} from '@/lib/metrics'
import { toLedgerEntries } from '@/lib/entries'
import { defaultCategoryId } from '@/domain/categories'
import { SEED_ACCOUNTS, SEED_TRANSACTIONS } from '@/sync/mockData'

const entries = toLedgerEntries(SEED_TRANSACTIONS, [], [])

describe('ledger metrics', () => {
  it('net worth sums account balances (credit card negative)', () => {
    // 842_512 checking + (-132_940) card + 1_540_000 savings
    expect(netWorthMinor(SEED_ACCOUNTS)).toBe(842_512 - 132_940 + 1_540_000)
  })

  it('spending by category is outflow-only magnitude, biggest first', () => {
    const rows = spendingByCategory(entries)
    // Income is excluded; every total is a positive magnitude.
    expect(rows.every((r) => r.totalMinor > 0)).toBe(true)
    expect(rows.some((r) => r.categoryId === defaultCategoryId('income'))).toBe(false)
    // Sorted biggest spend first, and rent dominates the ledger.
    expect(rows[0]!.totalMinor).toBeGreaterThanOrEqual(rows.at(-1)!.totalMinor)
    expect(rows[0]!.categoryId).toBe(defaultCategoryId('housing'))
  })

  it('monthly cash flow buckets income vs spend by month, oldest first', () => {
    const months = monthlyCashflow(entries)
    expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08'])
    const aug = months.find((m) => m.month === '2026-08')!
    expect(aug.incomeMinor).toBe(480_000)
    expect(aug.netMinor).toBe(aug.incomeMinor + aug.spendMinor)
  })

  it('totals split income and spend', () => {
    const t = totals(entries)
    expect(t.incomeMinor).toBe(480_000 * 3) // payroll every month
    expect(t.spendMinor).toBeLessThan(0)
    expect(t.netMinor).toBe(t.incomeMinor + t.spendMinor)
  })

  it('savings rate is in (0,1) and 0 with no income', () => {
    const rate = savingsRate(entries)
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(1)
    expect(savingsRate([])).toBe(0)
  })

  it('detects fixed subscriptions, not variable everyday spend', () => {
    const rec = detectRecurring(entries)
    const merchants = rec.map((r) => r.merchant)
    expect(merchants).toContain('Netflix')
    expect(merchants).toContain('Spotify')
    // Groceries recur monthly but the amount varies — not a subscription.
    expect(merchants).not.toContain('Whole Foods')

    const netflix = rec.find((r) => r.merchant === 'Netflix')!
    expect(netflix.count).toBe(3)
    expect(netflix.avgAmountMinor).toBe(-1_599)
    expect(netflix.cadence).toBe('monthly')
  })
})
