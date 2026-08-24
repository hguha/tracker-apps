// Proves Ledger runs on the SHARED engine: the same @tracker-engine/local-first
// SyncEngine, driven by Ledger's schema + Dexie deps, pulls server-authored bank rows
// and pushes only client-authored rows (entries/categories/…), never the bank tables.

import { beforeEach, describe, expect, it } from 'vitest'
import { syncStamp } from '@tracker-engine/local-first'
import { db } from '@/db'
import type { Category } from '@/domain/types'
import { LedgerSyncEngine } from '@/sync/engine'
import { enqueue } from '@/data/outbox'
import { MockBankBackend } from '@/sync/mockBackend'
import { SEED_ACCOUNTS, SEED_TRANSACTIONS, seedMockBackend } from '@/sync/mockData'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('ledger on the shared engine', () => {
  it('pulls server-authored bank rows into the local store', async () => {
    const backend = new MockBankBackend()
    seedMockBackend(backend)
    const engine = new LedgerSyncEngine(backend)

    await engine.pull()

    expect(await db.accounts.count()).toBe(SEED_ACCOUNTS.length)
    expect(await db.transactions.count()).toBe(SEED_TRANSACTIONS.length)
    // The bank balance came through the same pull path REPutation uses.
    const checking = await db.accounts.get('acc_checking')
    expect(checking?.currentBalanceMinor).toBe(842_512)
  })

  it('pushes client-authored rows but never server-authored bank rows', async () => {
    const backend = new MockBankBackend()
    seedMockBackend(backend)
    const engine = new LedgerSyncEngine(backend)

    // A client-authored category the user creates.
    const cat: Category = {
      id: 'cat_new',
      name: 'Coffee',
      icon: '☕',
      color: 'var(--cat-dining)',
      isIncome: false,
      archived: false,
      ...syncStamp(),
    }
    await db.categories.put(cat)
    await enqueue('categories', cat.id)

    await engine.sync() // drain + pull

    const pushedTables = new Set(backend.pushed.map((p) => p.table))
    expect(pushedTables.has('categories')).toBe(true)
    // serverAuthored tables are pull-only — the engine must never push them.
    expect(pushedTables.has('transactions')).toBe(false)
    expect(pushedTables.has('accounts')).toBe(false)
    // And the pull still landed the bank data.
    expect(await db.transactions.count()).toBe(SEED_TRANSACTIONS.length)
  })
})
