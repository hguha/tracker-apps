import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { isReadyToPush } from '@tracker-engine/local-first'
import {
  createSyncScope,
  type SyncStatus as SharedSyncStatus,
} from '@tracker-engine/local-first/react'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { bankSource } from './aggregation'
import { LedgerSyncEngine } from './engine'

export type { SyncPhase } from '@tracker-engine/local-first/react'

export type SyncStatus = SharedSyncStatus & { isMock: boolean }

const MOCK_USER = 'mock-bank'

const { SyncScope, useSyncStatus } = createSyncScope({
  tag: 'sync',
  createEngine: () => new LedgerSyncEngine(bankSource().backend),
  useSyncingUserId: () => {
    const { session } = useAuth()
    if (session && !session.isLocal) return session.userId
    return bankSource().isMock ? (session?.userId ?? MOCK_USER) : null
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
  afterReconcile: () => repo.applyRules(),
})

export { SyncScope }

export function useSync(): SyncStatus {
  return { ...useSyncStatus(), isMock: bankSource().isMock }
}
