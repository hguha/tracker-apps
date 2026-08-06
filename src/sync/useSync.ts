/**
 * Wires the sync engine to its drain triggers (§5.5).
 *
 * Triggers: app foreground (`visibilitychange`), the `online` event, and a 30s
 * interval while online. Each just asks the engine to reconcile; the engine
 * itself is re-entrant-safe, so overlapping triggers are harmless.
 *
 * When no backend is configured this hook does nothing — the prototype path,
 * where IndexedDB is the whole story. It also stays idle for an offline
 * ("use this device only") session: that account has no server identity, so
 * pushing its writes would only produce auth failures. It returns live
 * pending/dead-letter counts for the Settings surface either way.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import { useAuth } from '@/auth/AuthContext'
import { getSupabase } from './supabaseClient'
import { SupabaseBackend } from './supabaseBackend'
import { SyncEngine } from './engine'

const DRAIN_INTERVAL_MS = 30_000

export type SyncPhase = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  /** Writes still queued for the server. */
  pending: number
  /** Writes that failed permanently and need attention (§5.5). */
  deadLettered: number
  /** Whether sync is actively running for the current session. */
  enabled: boolean
  /** Live state of the most recent reconcile, for the manual button. */
  phase: SyncPhase
  /** Runs a reconcile now; resolves when it finishes. No-op when not enabled. */
  syncNow: () => Promise<void>
}

export function useSync(): SyncStatus {
  const { session } = useAuth()
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const engine = useMemo(() => {
    const client = getSupabase()
    return client ? new SyncEngine(new SupabaseBackend(client)) : null
  }, [])

  // Sync runs only for a real, server-backed session. An offline local account
  // (isLocal) stays entirely on-device — its data was a deliberate opt-out of
  // the network, and it has no JWT to authenticate a push with anyway.
  const active = engine !== null && session != null && !session.isLocal

  useEffect(() => {
    if (!active || !engine) return
    let cancelled = false

    const reconcile = () => {
      if (cancelled) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      void engine.sync()
    }

    reconcile()
    const interval = window.setInterval(reconcile, DRAIN_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile()
    }
    window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(interval)
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

  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const deadLettered = useLiveQuery(() => db.deadLetter.count(), [], 0)

  return { pending, deadLettered, enabled: active, phase, syncNow }
}
