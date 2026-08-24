// Binds the shared SyncEngine to Ledger's Dexie tables — the same injection seam
// REPutation uses (sync/deps.ts). Proof that @tracker-engine/local-first needs nothing
// from the app but a SyncDeps.

import { db } from '../db'
import type { OutboxEntry, SyncDeps } from '@tracker-engine/local-first'

// One outbox entry per (table, rowId), refreshed in place — the same collapse rule
// the engine expects.
export async function enqueue(table: string, rowId: string): Promise<void> {
  const existing = await db.outbox.where('[table+rowId]').equals([table, rowId]).first()
  if (existing?.seq !== undefined) {
    await db.outbox.update(existing.seq, { queuedAt: Date.now(), attempts: 0 })
    return
  }
  await db.outbox.add({ table, rowId, queuedAt: Date.now(), attempts: 0 } as OutboxEntry)
}

export function ledgerSyncDeps(): SyncDeps {
  return {
    outbox: {
      toArray: () => db.outbox.toArray(),
      delete: (seq) => db.outbox.delete(seq),
      update: (seq, changes) => db.outbox.update(seq, changes),
      clear: () => db.outbox.clear(),
      count: () => db.outbox.count(),
    },
    deadLetter: {
      toArray: () => db.deadLetter.toArray(),
      delete: (seq) => db.deadLetter.delete(seq),
      clear: () => db.deadLetter.clear(),
      count: () => db.deadLetter.count(),
    },
    syncState: {
      get: (table) => db.syncState.get(table),
      put: (state) => db.syncState.put(state),
      clear: () => db.syncState.clear(),
    },
    moveToDeadLetter: (seq, entry) =>
      db.transaction('rw', db.outbox, db.deadLetter, async () => {
        await db.deadLetter.add(entry)
        await db.outbox.delete(seq)
      }),
    enqueue,
    reportError: (tag, error) => console.warn(`[ledger] ${tag}`, error),
  }
}
