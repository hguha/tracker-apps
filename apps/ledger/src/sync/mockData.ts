// The demo bank feed: server-authored accounts + transactions the engine pulls,
// standing in for what the Plaid aggregation server will write (see sync/aggregation.ts).
// Deterministic (a fixed stamp), three months deep so the insights have something to
// show. Categories reference the seeded default ids so the aggregator's hints line up.

import { syncStamp } from '@tracker-engine/local-first'
import { defaultCategoryId } from '@/domain/categories'
import type { Account, Transaction } from '@/domain/types'
import type { MockBankBackend } from './mockBackend'

const T = 1_724_500_000_000 // fixed stamp → deterministic demo
const stamp = () => syncStamp(T)

export const SEED_ACCOUNTS: Account[] = [
  { id: 'acc_checking', name: 'Everyday Checking', institution: 'Aspen Bank', mask: '4821', type: 'depository', currentBalanceMinor: 842_512, currency: 'USD', ...stamp() },
  { id: 'acc_card', name: 'Rewards Card', institution: 'Aspen Bank', mask: '0097', type: 'credit', currentBalanceMinor: -132_940, currency: 'USD', ...stamp() },
  { id: 'acc_savings', name: 'High-Yield Savings', institution: 'Aspen Bank', mask: '5540', type: 'depository', currentBalanceMinor: 1_540_000, currency: 'USD', ...stamp() },
]

let n = 0
const tx = (
  account: 'checking' | 'card' | 'savings',
  categoryKey: string,
  amountMinor: number,
  date: string,
  merchant: string,
): Transaction => ({
  id: `t${(n += 1)}`,
  accountId: `acc_${account}`,
  categoryId: defaultCategoryId(categoryKey as never),
  amountMinor,
  currency: 'USD',
  date,
  merchant,
  pending: false,
  ...stamp(),
})

// Recurring anchors (payroll, rent, subscriptions, utilities) stay constant so the
// subscription detector picks them up; everyday spend varies month to month (jitter)
// so it reads like real discretionary spending, not a fixed bill.
const JITTER = [1, 1.14, 0.88] // one factor per month
const vary = (base: number, i: number) => Math.round(base * JITTER[i]!)

const month = (m: string, i: number): Transaction[] => [
  tx('checking', 'income', 480_000, `${m}-01`, 'Acme Payroll'),
  tx('checking', 'housing', -190_000, `${m}-02`, 'Sunset Apartments'),
  tx('card', 'subscriptions', -1_599, `${m}-15`, 'Netflix'),
  tx('card', 'subscriptions', -1_099, `${m}-02`, 'Spotify'),
  tx('card', 'utilities', -8_450, `${m}-08`, 'City Power & Light'),
  tx('card', 'groceries', vary(-8_642, i), `${m}-03`, 'Whole Foods'),
  tx('card', 'groceries', vary(-6_130, i), `${m}-17`, 'Trader Joes'),
  tx('card', 'dining', vary(-3_215, i), `${m}-05`, 'Sweetgreen'),
  tx('card', 'dining', vary(-4_780, i), `${m}-12`, 'Ramen Bar'),
  tx('card', 'dining', vary(-2_950, i), `${m}-21`, 'Blue Bottle'),
  tx('card', 'transport', vary(-4_500, i), `${m}-06`, 'Metro Transit'),
  tx('card', 'shopping', vary(-5_499, i), `${m}-19`, 'Uniqlo'),
]

export const SEED_TRANSACTIONS: Transaction[] = [
  ...month('2026-06', 0),
  ...month('2026-07', 1),
  ...month('2026-08', 2),
  // A couple of extras in the current month so it isn't a carbon copy.
  tx('card', 'health', -6_800, '2026-08-22', 'City Pharmacy'),
  tx('card', 'entertainment', -3_200, '2026-08-24', 'Regal Cinemas'),
]

/** Seed the mock server with the bank-sourced (server-authored) rows the engine pulls. */
export function seedMockBackend(backend: MockBankBackend): void {
  backend.seed('accounts', SEED_ACCOUNTS as unknown as Record<string, unknown>[])
  backend.seed('transactions', SEED_TRANSACTIONS as unknown as Record<string, unknown>[])
}
