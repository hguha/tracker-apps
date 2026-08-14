// Wires the sync engine to its triggers (§5.5): push is event-driven, pull only on
// open/foreground — never on a timer, since a background re-render lands mid-touch on a phone.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { db, isReadyToPush } from '@/db/database'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { getSupabase } from './supabaseClient'
import { SupabaseBackend } from './supabaseBackend'
import { SyncEngine } from './engine'

export type SyncPhase = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  /** Ready to send; excludes an in-progress workout's writes, held until Finish. */
  pending: number
  deferred: number
  deadLettered: number
  enabled: boolean
  phase: SyncPhase
  syncNow: () => Promise<void>
  retryFailed: () => Promise<number>
  eraseServerData: () => Promise<{ failed: { table: string; error: string }[] }>
  discardLocalChanges: () => Promise<{ discarded: number; applied: number }>
  uploadEverything: (
    onProgress?: (progress: { pushed: number; remaining: number }) => void,
  ) => Promise<{ pushed: number; deadLettered: number; remaining: number }>
}

export function useSync(): SyncStatus {
  const { session } = useAuth()
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const engine = useMemo(() => {
    const client = getSupabase()
    return client ? new SyncEngine(new SupabaseBackend(client)) : null
  }, [])

  // An offline (isLocal) account has no JWT and opted out of the network.
  const active = engine !== null && session != null && !session.isLocal

  useEffect(() => {
    if (!active || !engine) return
    let cancelled = false

    const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

    // One drain loop at a time; the outbox observer fires on every write and we
    // don't want overlapping loops racing.
    let draining = false
    const push = () => {
      if (cancelled || isOffline() || draining) return
      draining = true
      // drainUntilSettled, not a single drain: a big burst (e.g. claiming a ton
      // of local data on sign-in) can hit transient blips, and this waits out
      // each backoff and keeps going instead of leaving the rest stuck until the
      // next foreground.
      void engine
        .drainUntilSettled()
        .catch((error) => console.warn('[sync] drain threw', error))
        .finally(() => {
          draining = false
        })
    }

    // Pull + push only on open/foreground, never on a timer (see file header).
    const reconcile = () => {
      if (cancelled || isOffline()) return
      engine.sync().catch((error) => {
        console.warn('[sync] reconcile threw', error)
      })
    }

    reconcile()

    // Push whenever a write lands in the outbox, instead of polling.
    const subscription = liveQuery(() => db.outbox.count()).subscribe({
      next: (count) => {
        if (count > 0) push()
      },
      error: (error) => console.warn('[sync] outbox observer failed', error),
    })

    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      window.removeEventListener('online', reconcile)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, engine])

  const syncNow = useCallback(async () => {
    if (!active || !engine) return
    setPhase('syncing')
    try {
      const { remaining } = await engine.drainUntilSettled()
      await engine.pull()
      setPhase(remaining > 0 ? 'error' : 'idle')
    } catch {
      setPhase('error')
    }
  }, [active, engine])

  const retryFailed = useCallback(async () => {
    if (!active || !engine || !session || session.isLocal) return 0
    setPhase('syncing')
    try {
      // Repair ownership first: rows still owned by 'local-user' are rejected by RLS forever.
      const claimed = await repo.claimLocalData(session.userId)
      if (claimed > 0) {
        console.info(`[sync] re-owned ${claimed} rows to ${session.userId} before retry`)
      }
      const count = await engine.retryDeadLettered()
      // Settle rather than run one pass: a re-queued parent lands first, and its
      // children need the next round to follow it.
      const { remaining } = await engine.drainUntilSettled()
      await engine.pull()
      setPhase(remaining > 0 ? 'error' : 'idle')
      return count + claimed
    } catch {
      setPhase('error')
      return 0
    }
  }, [active, engine, session])

  const eraseServerData = useCallback(async () => {
    if (!active || !engine) return { failed: [] }
    setPhase('syncing')
    try {
      const result = await engine.hardDeleteServerData()
      setPhase(result.failed.length > 0 ? 'error' : 'idle')
      return result
    } catch (error) {
      setPhase('error')
      return { failed: [{ table: 'unknown', error: String(error) }] }
    }
  }, [active, engine])

  const discardLocalChanges = useCallback(async () => {
    if (!active || !engine) return { discarded: 0, applied: 0 }
    setPhase('syncing')
    try {
      const result = await engine.discardLocalChanges()
      setPhase('idle')
      return result
    } catch {
      setPhase('error')
      return { discarded: 0, applied: 0 }
    }
  }, [active, engine])

  const uploadEverything = useCallback(
    async (onProgress?: (p: { pushed: number; remaining: number }) => void) => {
      if (!active || !engine) return { pushed: 0, deadLettered: 0, remaining: 0 }
      setPhase('syncing')
      try {
        // Repair ownership first: rows still stamped 'local-user' are rejected by RLS forever.
        if (session && !session.isLocal) await repo.claimLocalData(session.userId)
        const result = await engine.drainUntilSettled({ onProgress })
        setPhase(result.remaining > 0 ? 'error' : 'idle')
        return result
      } catch {
        setPhase('error')
        return { pushed: 0, deadLettered: 0, remaining: 0 }
      }
    },
    [active, engine, session],
  )

  // Split the queue: reporting held writes as "pending" would show a count the user can't clear.
  const counts = useLiveQuery(
    async () => {
      const all = await db.outbox.toArray()
      return {
        pending: all.filter(isReadyToPush).length,
        deferred: all.filter((e) => !isReadyToPush(e)).length,
      }
    },
    [],
    { pending: 0, deferred: 0 },
  )
  const deadLettered = useLiveQuery(() => db.deadLetter.count(), [], 0)

  return {
    pending: counts.pending,
    deferred: counts.deferred,
    deadLettered,
    enabled: active,
    phase,
    syncNow,
    retryFailed,
    eraseServerData,
    discardLocalChanges,
    uploadEverything,
  }
}
