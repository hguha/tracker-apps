// Binds the generic SyncEngine to REPutation's Dexie tables + app services. This is
// the seam the engine used to import directly (db / repository.enqueue /
// errorReporter.reportError); injecting it here is what lets @tracker-engine/local-first stay
// free of app imports.

import { db } from '@/db/database'
import { enqueue } from '@/data/repository'
import { reportError } from '@/backend/errorReporter'
import type { SyncDeps } from '@tracker-engine/local-first'

export function appSyncDeps(): SyncDeps {
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
    reportError,
  }
}
