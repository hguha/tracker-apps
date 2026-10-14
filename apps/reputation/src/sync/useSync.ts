import { SupabaseBackend } from '@tracker-engine/local-first'
import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { createSyncScope } from '@tracker-engine/local-first/react'
import { db, isReadyToPush } from '@/db/database'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { getSupabase } from '@/backend/supabaseClient'
import { SyncEngine } from './engine'

export type { SyncPhase, SyncStatus } from '@tracker-engine/local-first/react'

export const { SyncScope, useSyncStatus: useSync } = createSyncScope({
  tag: 'sync',
  createEngine: () => {
    const client = getSupabase()
    return client ? new SyncEngine(new SupabaseBackend(client)) : null
  },
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
  claimOwnership: repo.claimLocalData,
})
