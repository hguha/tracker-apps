import { db } from '@/db'
import { enqueue } from '@/data/outbox'
import { createSyncDeps, type SyncDeps } from '@tracker-engine/local-first'
import { reportError } from '@/backend/errorReporter'

export function macroSyncDeps(): SyncDeps {
  return createSyncDeps({
    tag: 'macros',
    enqueue,
    reportError,
    tables: {
      outbox: db.outbox,
      deadLetter: db.deadLetter,
      syncState: {
        get: (table) => db.syncState.get(table),
        put: (state) => db.syncState.put(state),
        clear: () => db.syncState.clear(),
      },
      transaction: (run) => db.transaction('rw', db.outbox, db.deadLetter, run),
    },
  })
}
