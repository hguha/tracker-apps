import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { isReadyToPush } from '@tracker-engine/local-first'
import { createSyncScope } from '@tracker-engine/local-first/react'
import { db } from '@/db'
import { claimLocalData, migrateSavedMeals } from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { macroSyncEngine } from './backend'

export const { SyncScope, useSyncStatus } = createSyncScope({
  tag: 'sync',
  createEngine: macroSyncEngine,
  useSyncingUserId: () => {
    const { session } = useAuth()
    return session && !session.isLocal ? session.userId : null
  },
  useCounts: () =>
    useLiveQuery(
      async () => {
        const queued = await db.outbox.toArray()
        const ready = queued.filter(isReadyToPush).length
        return {
          pending: ready,
          deferred: queued.length - ready,
          deadLettered: await db.deadLetter.count(),
        }
      },
      [],
      { pending: 0, deferred: 0, deadLettered: 0 },
    ),
  observeOutbox: (onCount) => {
    const subscription = liveQuery(() => db.outbox.count()).subscribe({
      next: onCount,
      error: (error) => console.warn('[sync] outbox observer failed', error),
    })
    return () => subscription.unsubscribe()
  },
  claimOwnership: claimLocalData,
  afterReconcile: migrateSavedMeals,
})
