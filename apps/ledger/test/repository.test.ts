// Integration test: the repository (data layer) + Dexie + the shared engine working
// together. Pulls the seeded bank feed, then exercises the client-authored write paths
// (manual entry, recategorizing a bank txn via an override, budgets) and confirms they
// land in the unified read model and queue for sync.

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import * as metrics from '@/lib/metrics'
import { LedgerSyncEngine } from '@/sync/engine'
import { MockBankBackend } from '@/sync/mockBackend'
import { seedMockBackend } from '@/sync/mockData'

async function freshWithBankData() {
  await db.delete()
  await db.open()
  await repo.seedIfNeeded()
  const backend = new MockBankBackend()
  seedMockBackend(backend)
  await new LedgerSyncEngine(backend).pull()
  return backend
}

beforeEach(async () => {
  await freshWithBankData()
})

describe('repository + engine integration', () => {
  it('seeds the default categories (client-authored, queued to push)', async () => {
    const categories = await repo.listCategories()
    expect(categories.find((c) => c.name === 'Groceries')).toBeTruthy()
    // Every seeded category queued a push.
    expect(await db.outbox.where('table').equals('categories').count()).toBeGreaterThan(0)
  })

  it('adds a manual entry that appears in the unified ledger and queues to push', async () => {
    const before = (await repo.listLedgerEntries()).length
    await repo.addEntry({
      amountMinor: -1299,
      date: '2026-08-20',
      merchant: 'Corner Cafe',
      categoryId: 'cat_dining',
    })
    const after = await repo.listLedgerEntries()
    expect(after.length).toBe(before + 1)
    const added = after.find((e) => e.merchant === 'Corner Cafe')!
    expect(added.source).toBe('manual')
    expect(await db.outbox.where('table').equals('entries').count()).toBe(1)
  })

  it('recategorizes a bank transaction via a synced override, not by mutating the row', async () => {
    const bank = (await repo.listLedgerEntries()).find((e) => e.source === 'bank')!
    const original = await db.transactions.get(bank.id)

    await repo.setEntryCategory(bank, 'cat_transport')

    // The server-authored row is untouched; the override carries the new category.
    expect((await db.transactions.get(bank.id))?.categoryId).toBe(original?.categoryId)
    const reread = (await repo.listLedgerEntries()).find((e) => e.id === bank.id)!
    expect(reread.categoryId).toBe('cat_transport')
    expect(await db.outbox.where('table').equals('categoryOverrides').count()).toBe(1)
  })

  it('sets a budget that the metrics layer reads back', async () => {
    await repo.setBudget('cat_dining', 20_000)
    const budgets = await repo.listBudgets()
    const entries = await repo.listLedgerEntries()
    const progress = metrics.budgetProgress(entries, budgets)
    const dining = progress.find((p) => p.categoryId === 'cat_dining')!
    expect(dining.limitMinor).toBe(20_000)
    expect(dining.spentMinor).toBeGreaterThan(0)
  })

  it('deletes a manual entry (tombstone) so it leaves the ledger', async () => {
    const id = await repo.addEntry({
      amountMinor: -400,
      date: '2026-08-18',
      merchant: 'Temp',
      categoryId: null,
    })
    await repo.deleteEntry(id)
    expect((await repo.listLedgerEntries()).some((e) => e.id === id)).toBe(false)
  })
})
