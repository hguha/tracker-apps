// Ledger's canonical calculation layer — the finance analogue of REPutation's
// lib/metrics.ts. Every insight (net worth, spend, cash flow, subscriptions, savings,
// budgets) is computed here, once, in integer minor units, so the screens, the coach,
// and the budgets never disagree (calc-consistency, principle #7). Pure.

import type { Account, Budget, LedgerEntry } from '@/domain/types'
import { DAY_MS, monthKey } from './dates'

export function netWorthMinor(accounts: Account[]): number {
  return accounts
    .filter((a) => a.deletedAt === null)
    .reduce((sum, a) => sum + a.currentBalanceMinor, 0)
}

export interface Totals {
  incomeMinor: number // positive
  spendMinor: number // negative
  netMinor: number
}

export function totals(entries: LedgerEntry[]): Totals {
  let income = 0
  let spend = 0
  for (const e of entries) {
    if (e.amountMinor >= 0) income += e.amountMinor
    else spend += e.amountMinor
  }
  return { incomeMinor: income, spendMinor: spend, netMinor: income + spend }
}

/** Savings rate over the set, 0–1. Zero when there's no income. */
export function savingsRate(entries: LedgerEntry[]): number {
  const { incomeMinor, spendMinor } = totals(entries)
  if (incomeMinor <= 0) return 0
  return Math.max(0, (incomeMinor + spendMinor) / incomeMinor)
}

export interface CategorySpend {
  categoryId: string // 'uncategorized' when null
  totalMinor: number // positive magnitude of outflow
}

/** Outflow magnitude per category, biggest first. Income (positive) is excluded. */
export function spendingByCategory(entries: LedgerEntry[]): CategorySpend[] {
  const totalsByCat = new Map<string, number>()
  for (const e of entries) {
    if (e.amountMinor >= 0) continue
    const key = e.categoryId ?? 'uncategorized'
    totalsByCat.set(key, (totalsByCat.get(key) ?? 0) + -e.amountMinor)
  }
  return [...totalsByCat.entries()]
    .map(([categoryId, totalMinor]) => ({ categoryId, totalMinor }))
    .sort((a, b) => b.totalMinor - a.totalMinor)
}

export interface MonthCashflow {
  month: string // YYYY-MM
  incomeMinor: number
  spendMinor: number // negative
  netMinor: number
}

/** Income vs. spend per calendar month, oldest first. */
export function monthlyCashflow(entries: LedgerEntry[]): MonthCashflow[] {
  const byMonth = new Map<string, { income: number; spend: number }>()
  for (const e of entries) {
    const month = monthKey(e.date)
    const bucket = byMonth.get(month) ?? { income: 0, spend: 0 }
    if (e.amountMinor >= 0) bucket.income += e.amountMinor
    else bucket.spend += e.amountMinor
    byMonth.set(month, bucket)
  }
  return [...byMonth.entries()]
    .map(([month, { income, spend }]) => ({
      month,
      incomeMinor: income,
      spendMinor: spend,
      netMinor: income + spend,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export interface MerchantSpend {
  merchant: string
  totalMinor: number // positive magnitude
  count: number
}

/** Top merchants by outflow, biggest first. */
export function topMerchants(entries: LedgerEntry[], limit = 5): MerchantSpend[] {
  const byMerchant = new Map<string, { total: number; count: number }>()
  for (const e of entries) {
    if (e.amountMinor >= 0) continue
    const b = byMerchant.get(e.merchant) ?? { total: 0, count: 0 }
    b.total += -e.amountMinor
    b.count += 1
    byMerchant.set(e.merchant, b)
  }
  return [...byMerchant.entries()]
    .map(([merchant, { total, count }]) => ({ merchant, totalMinor: total, count }))
    .sort((a, b) => b.totalMinor - a.totalMinor)
    .slice(0, limit)
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'irregular'

function classifyCadence(days: number): Cadence {
  if (days <= 8) return 'weekly'
  if (days <= 17) return 'biweekly'
  if (days <= 45) return 'monthly'
  if (days >= 350 && days <= 400) return 'yearly'
  return 'irregular'
}

export interface Recurring {
  merchant: string
  count: number
  avgAmountMinor: number // negative (outflow)
  cadence: Cadence
  cadenceDays: number
  lastDate: string
}

/**
 * Likely subscriptions/bills: a merchant charged more than once on a roughly
 * regular cadence. The seed of every "what am I paying for?" insight.
 */
export function detectRecurring(entries: LedgerEntry[]): Recurring[] {
  const byMerchant = new Map<string, LedgerEntry[]>()
  for (const e of entries) {
    if (e.amountMinor >= 0) continue
    const list = byMerchant.get(e.merchant) ?? []
    list.push(e)
    byMerchant.set(e.merchant, list)
  }

  const out: Recurring[] = []
  for (const [merchant, list] of byMerchant) {
    if (list.length < 2) continue
    const dates = list.map((t) => t.date).sort()
    let gapSum = 0
    for (let i = 1; i < dates.length; i += 1) {
      gapSum += (Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / DAY_MS
    }
    const avgGap = gapSum / (dates.length - 1)
    const cadence = classifyCadence(avgGap)
    if (cadence === 'irregular') continue // one-off spikes aren't subscriptions

    // A subscription/bill charges a near-constant amount. Variable spend at the same
    // merchant (groceries every week) recurs but isn't a subscription, so gate on the
    // amount spread staying tight.
    const amounts = list.map((t) => t.amountMinor)
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
    const spread = (Math.max(...amounts) - Math.min(...amounts)) / Math.abs(mean || 1)
    if (spread > 0.15) continue

    const avgAmountMinor = Math.round(mean)
    out.push({
      merchant,
      count: list.length,
      avgAmountMinor,
      cadence,
      cadenceDays: Math.round(avgGap),
      lastDate: dates[dates.length - 1]!,
    })
  }
  return out.sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant))
}

export interface BudgetProgress {
  categoryId: string
  limitMinor: number
  spentMinor: number // positive magnitude
  ratio: number // spent / limit, may exceed 1
  overBy: number // minor units over the limit, 0 if under
}

/**
 * Per-budget spend vs. limit for a set of entries (typically one month). Spend uses
 * the same category grouping as `spendingByCategory`, so a budget bar and the
 * category chart can never show different numbers.
 */
export function budgetProgress(
  entries: LedgerEntry[],
  budgets: Budget[],
): BudgetProgress[] {
  const spendByCat = new Map(
    spendingByCategory(entries).map((s) => [s.categoryId, s.totalMinor]),
  )
  return budgets
    .filter((b) => b.deletedAt === null && b.limitMinor > 0)
    .map((b) => {
      const spentMinor = spendByCat.get(b.categoryId) ?? 0
      return {
        categoryId: b.categoryId,
        limitMinor: b.limitMinor,
        spentMinor,
        ratio: spentMinor / b.limitMinor,
        overBy: Math.max(0, spentMinor - b.limitMinor),
      }
    })
    .sort((a, b) => b.ratio - a.ratio)
}
