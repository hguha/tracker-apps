// Sample data for the demo. Categories are client-authored (seeded locally into Dexie);
// accounts + transactions are server-authored (seeded into the mock bank backend, pulled
// by the engine) — mirroring how real aggregation would feed them in.

import { syncStamp } from '@tracker-engine/local-first'
import type { Account, Category, Transaction } from './domain'
import type { MockBankBackend } from './sync/mockBackend'

const T = 1_700_000_000_000 // fixed stamp so the demo is deterministic
const stamp = () => syncStamp(T)

export const SEED_CATEGORIES: Category[] = [
  { id: 'cat_income', name: 'Income', icon: '💰', ...stamp() },
  { id: 'cat_groceries', name: 'Groceries', icon: '🛒', ...stamp() },
  { id: 'cat_dining', name: 'Dining', icon: '🍽️', ...stamp() },
  { id: 'cat_transport', name: 'Transport', icon: '🚇', ...stamp() },
  { id: 'cat_shopping', name: 'Shopping', icon: '🛍️', ...stamp() },
  { id: 'cat_subs', name: 'Subscriptions', icon: '🔁', ...stamp() },
]

export const SEED_ACCOUNTS: Account[] = [
  { id: 'acc_checking', name: 'Everyday Checking', mask: '4821', type: 'depository', currentBalanceMinor: 342_512, currency: 'USD', ...stamp() },
  { id: 'acc_card', name: 'Rewards Card', mask: '0097', type: 'credit', currentBalanceMinor: -87_340, currency: 'USD', ...stamp() },
]

// amountMinor: outflow negative, income positive.
const tx = (
  id: string,
  accountId: string,
  categoryId: string,
  amountMinor: number,
  date: string,
  merchant: string,
): Transaction => ({
  id, accountId, categoryId, amountMinor, currency: 'USD', date, merchant, pending: false, ...stamp(),
})

export const SEED_TRANSACTIONS: Transaction[] = [
  tx('t1', 'acc_checking', 'cat_income', 480_000, '2026-08-01', 'Acme Payroll'),
  tx('t2', 'acc_card', 'cat_groceries', -8_642, '2026-08-03', 'Whole Foods'),
  tx('t3', 'acc_card', 'cat_dining', -3_215, '2026-08-04', 'Sweetgreen'),
  tx('t4', 'acc_checking', 'cat_transport', -12_000, '2026-08-05', 'Transit Authority'),
  tx('t5', 'acc_card', 'cat_shopping', -5_499, '2026-08-06', 'Uniqlo'),
  tx('t6', 'acc_card', 'cat_groceries', -6_130, '2026-08-10', 'Trader Joes'),
  tx('t7', 'acc_card', 'cat_dining', -4_780, '2026-08-12', 'Ramen Bar'),
  tx('t8', 'acc_card', 'cat_dining', -2_950, '2026-08-14', 'Blue Bottle'),
  // Recurring charges — same merchant + amount on a monthly cadence, so the
  // subscription detector has something to find.
  tx('t9', 'acc_card', 'cat_subs', -1_599, '2026-06-15', 'Netflix'),
  tx('t10', 'acc_card', 'cat_subs', -1_599, '2026-07-15', 'Netflix'),
  tx('t11', 'acc_card', 'cat_subs', -1_599, '2026-08-15', 'Netflix'),
  tx('t12', 'acc_card', 'cat_subs', -1_099, '2026-07-02', 'Spotify'),
  tx('t13', 'acc_card', 'cat_subs', -1_099, '2026-08-02', 'Spotify'),
]

/** Seed the mock server with the bank-sourced (server-authored) rows the engine pulls. */
export function seedBankBackend(backend: MockBankBackend): void {
  backend.seed('accounts', SEED_ACCOUNTS as unknown as Record<string, unknown>[])
  backend.seed('transactions', SEED_TRANSACTIONS as unknown as Record<string, unknown>[])
}
