// The unified read model: bank transactions + manual entries flatten into one list,
// with user re-categorization applied and tombstones dropped.

import { describe, expect, it } from 'vitest'
import { syncStamp } from '@tracker-engine/local-first'
import { toLedgerEntries } from '@/lib/entries'
import type { CategoryOverride, Entry, Transaction } from '@/domain/types'

const bankTxn = (over: Partial<Transaction>): Transaction => ({
  id: 't1',
  accountId: 'acc',
  categoryId: 'cat_dining',
  amountMinor: -1000,
  currency: 'USD',
  date: '2026-08-10',
  merchant: 'Cafe',
  pending: false,
  ...syncStamp(),
  ...over,
})

const manual = (over: Partial<Entry>): Entry => ({
  id: 'e1',
  accountId: null,
  categoryId: 'cat_groceries',
  amountMinor: -500,
  currency: 'USD',
  date: '2026-08-12',
  merchant: 'Market',
  note: 'cash',
  ...syncStamp(),
  ...over,
})

describe('toLedgerEntries', () => {
  it('merges bank + manual entries, newest first', () => {
    const rows = toLedgerEntries([bankTxn({})], [manual({})], [])
    expect(rows).toHaveLength(2)
    expect(rows[0]!.id).toBe('e1') // 08-12 before 08-10
    expect(rows.map((r) => r.source).sort()).toEqual(['bank', 'manual'])
  })

  it('applies a category override to a bank transaction', () => {
    const override: CategoryOverride = { id: 't1', categoryId: 'cat_transport', ...syncStamp() }
    const [row] = toLedgerEntries([bankTxn({})], [], [override])
    expect(row!.categoryId).toBe('cat_transport')
  })

  it('drops soft-deleted rows and deleted overrides', () => {
    const deletedTxn = bankTxn({ id: 't2', deletedAt: Date.now() })
    const deletedOverride: CategoryOverride = {
      id: 't1',
      categoryId: 'cat_transport',
      ...syncStamp(),
      deletedAt: Date.now(),
    }
    const rows = toLedgerEntries([bankTxn({}), deletedTxn], [], [deletedOverride])
    expect(rows).toHaveLength(1)
    // The deleted override is ignored, so the original bank category stands.
    expect(rows[0]!.categoryId).toBe('cat_dining')
  })
})
