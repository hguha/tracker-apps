// The unified read model. Bank transactions (server-authored, with any user
// re-categorization applied) and manual entries (client-authored) flatten into one
// `LedgerEntry[]` so every screen and every metric works on a single shape and can't
// disagree about what counts. Pure — no DB, so it's trivially testable.

import type {
  CategoryOverride,
  Entry,
  LedgerEntry,
  Transaction,
} from '@/domain/types'

const isLive = (row: { deletedAt: number | null }): boolean => row.deletedAt === null

export function toLedgerEntries(
  transactions: Transaction[],
  entries: Entry[],
  overrides: CategoryOverride[],
): LedgerEntry[] {
  const overrideOf = new Map(
    overrides.filter(isLive).map((o) => [o.id, o.categoryId]),
  )

  const fromBank: LedgerEntry[] = transactions.filter(isLive).map((t) => ({
    id: t.id,
    source: 'bank',
    accountId: t.accountId,
    categoryId: overrideOf.has(t.id) ? overrideOf.get(t.id)! : t.categoryId,
    amountMinor: t.amountMinor,
    currency: t.currency,
    date: t.date,
    merchant: t.merchant,
    note: '',
    pending: t.pending,
  }))

  const fromManual: LedgerEntry[] = entries.filter(isLive).map((e) => ({
    id: e.id,
    source: 'manual',
    accountId: e.accountId,
    categoryId: e.categoryId,
    amountMinor: e.amountMinor,
    currency: e.currency,
    date: e.date,
    merchant: e.merchant,
    note: e.note,
    pending: false,
  }))

  // Newest first — the order every list wants; metrics re-bucket regardless.
  return [...fromBank, ...fromManual].sort((a, b) => b.date.localeCompare(a.date))
}
