// Binds the shared SyncEngine to Ledger's Dexie tables — the same injection seam
// REPutation uses. The engine imports nothing from the app but this SyncDeps. The
// canonical enqueue lives in the data layer (data/outbox); sync wires it in.

import { db } from '@/db'
import { enqueue } from '@/data/outbox'
import type { SyncDeps } from '@tracker-engine/local-first'

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
