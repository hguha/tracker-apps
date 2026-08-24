// Ledger's canonical calculation layer — the finance analogue of REPutation's
// lib/metrics.ts. Every insight (spend, cash flow, subscriptions, savings rate) is
// computed here, once, in integer minor units, so the screen, a future coach, and
// budgets never disagree (calc-consistency, principle #7 in the handbook). Pure.

import type { Account, Transaction } from './domain'

const DAY_MS = 86_400_000

export function netWorthMinor(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + a.currentBalanceMinor, 0)
}

export interface CategorySpend {
  categoryId: string
  totalMinor: number // negative (outflow)
}

/** Outflow totals per category, biggest spend first. */
export function spendingByCategory(txns: Transaction[]): CategorySpend[] {
  const totals = new Map<string, number>()
  for (const t of txns) {
    if (t.amountMinor >= 0) continue
    const key = t.categoryId ?? 'uncategorized'
    totals.set(key, (totals.get(key) ?? 0) + t.amountMinor)
  }
  return [...totals.entries()]
    .map(([categoryId, totalMinor]) => ({ categoryId, totalMinor }))
    .sort((a, b) => a.totalMinor - b.totalMinor)
}

export interface MonthCashflow {
  month: string // YYYY-MM
  incomeMinor: number
  spendMinor: number // negative
  netMinor: number
}

/** Income vs. spend per calendar month, oldest first. */
export function monthlyCashflow(txns: Transaction[]): MonthCashflow[] {
  const byMonth = new Map<string, { income: number; spend: number }>()
  for (const t of txns) {
    const month = t.date.slice(0, 7)
    const bucket = byMonth.get(month) ?? { income: 0, spend: 0 }
    if (t.amountMinor >= 0) bucket.income += t.amountMinor
    else bucket.spend += t.amountMinor
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

/** Savings rate over the period, 0–1. Zero when there's no income. */
export function savingsRate(txns: Transaction[]): number {
  let income = 0
  let spend = 0
  for (const t of txns) {
    if (t.amountMinor >= 0) income += t.amountMinor
    else spend += -t.amountMinor
  }
  if (income <= 0) return 0
  return Math.max(0, (income - spend) / income)
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
 * Detects likely subscriptions/bills: a merchant charged more than once, on a
 * roughly regular cadence. The seed of every "what am I paying for?" insight.
 */
export function detectRecurring(txns: Transaction[]): Recurring[] {
  const byMerchant = new Map<string, Transaction[]>()
  for (const t of txns) {
    if (t.amountMinor >= 0) continue // only outflows recur as subscriptions
    const list = byMerchant.get(t.merchant) ?? []
    list.push(t)
    byMerchant.set(t.merchant, list)
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
    const avgAmountMinor = Math.round(
      list.reduce((s, t) => s + t.amountMinor, 0) / list.length,
    )
    out.push({
      merchant,
      count: list.length,
      avgAmountMinor,
      cadence: classifyCadence(avgGap),
      cadenceDays: Math.round(avgGap),
      lastDate: dates[dates.length - 1]!,
    })
  }
  return out.sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant))
}
