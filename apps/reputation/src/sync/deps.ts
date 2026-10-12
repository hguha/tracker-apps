import { db } from '@/db/database'
import { enqueue } from '@/data/repository'
import { reportError } from '@/backend/errorReporter'
import { createSyncDeps, type SyncDeps } from '@tracker-engine/local-first'

export function appSyncDeps(): SyncDeps {
  return createSyncDeps({
    tag: 'reputation',
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
