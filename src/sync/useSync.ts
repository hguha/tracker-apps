/**
 * Wires the sync engine to its triggers (§5.5).
 *
 * Push is event-driven (an enqueued write, or `online`); pull happens only on app
 * open/foreground or on request. Never on a timer: a background pull writes to
 * IndexedDB, every `useLiveQuery` re-runs, and that re-render lands mid-touch on a
 * phone — the button takes its `:active` style but the tap never registers. An
 * in-progress workout isn't pushed at all until Finish (see `deferralFor`).
 *
 * Idle with no backend configured, and idle for an offline ("this device only")
 * session, which has no server identity. Returns live counts either way.
 */

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
  /** Writes queued and ready to send. Excludes an in-progress workout's writes,
   *  which are deliberately held until Finish and aren't actionable. */
  pending: number
  /** Writes held back because their workout is still in progress. */
  deferred: number
  deadLettered: number
  enabled: boolean
  phase: SyncPhase
  /** Runs a reconcile now; resolves when it finishes. No-op when not enabled. */
  syncNow: () => Promise<void>
  /** Requeues dead-lettered writes and drains, for the "retry failed" action.
   *  Resolves to how many were requeued. */
  retryFailed: () => Promise<number>
  /**
   * Physically erases this user's training data from the server (§11.3), for the
   * "delete everything" action. Resolves to any per-table failures, so the
   * caller can report a partial failure honestly. A no-op with no backend.
   */
  eraseServerData: () => Promise<{ failed: { table: string; error: string }[] }>
  /**
   * Throws away un-pushed local changes and adopts the server's version, for the
   * "my local copy is wrong" escape hatch. Resolves to what it discarded/applied.
   */
  discardLocalChanges: () => Promise<{ discarded: number; applied: number }>
  /**
   * Pushes the whole queue, retrying through backoffs until it settles, for the
   * first-run upload (§11.1.3). One call replaces the "sync failed, retry, retry"
   * loop a user with existing local data used to hit.
   */
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

    // Push only. Safe to call often: the engine is re-entrant-safe and a drain
    // with an empty (or fully deferred) queue costs nothing.
    const push = () => {
      if (cancelled || isOffline()) return
      engine.drain().catch((error) => {
        console.warn('[sync] drain threw', error)
      })
    }

    // Pull + push. Only on open/foreground, never on a timer, so a background
    // write can't re-render the screen while it's being used.
    const reconcile = () => {
      if (cancelled || isOffline()) return
      engine.sync().catch((error) => {
        console.warn('[sync] reconcile threw', error)
      })
    }

    reconcile()

    // Push whenever a write lands in the outbox. Dexie's observable fires on
    // change, so this replaces polling with "send it when there's something to
    // send". Deferred (in-progress-workout) entries are skipped by the drain, so
    // logging a set costs a no-op drain rather than a request.
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
      const { drain } = await engine.sync()
      setPhase(drain.stoppedBecause === null ? 'idle' : 'error')
    } catch {
      setPhase('error')
    }
  }, [active, engine])

  const retryFailed = useCallback(async () => {
    if (!active || !engine || !session || session.isLocal) return 0
    setPhase('syncing')
    try {
      // Repair ownership first. Rows written before this account existed (or
      // during a failed upgrade) can still be owned by 'local-user', which the
      // server's RLS rejects forever — the "new row violates row-level security
      // policy" failure. claimLocalData is idempotent, so this is a no-op once
      // everything is owned correctly.
      const claimed = await repo.claimLocalData(session.userId)
      if (claimed > 0) {
        console.info(`[sync] re-owned ${claimed} rows to ${session.userId} before retry`)
      }
      const count = await engine.retryDeadLettered()
      const { drain } = await engine.sync()
      setPhase(drain.stoppedBecause === null ? 'idle' : 'error')
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
        // Repair ownership first: rows logged before this account existed are
        // still stamped 'local-user' and would be rejected by RLS forever.
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

  // Split the queue: what's ready to send vs what's held for a live workout.
  // Reporting held writes as "pending" would show a count the user can't clear.
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
