// Wires the sync engine to its triggers, mirroring REPutation's useSync: push is
// event-driven (on every outbox write), pull only on open/foreground — never on a
// timer. In demo (mock) mode it runs regardless of auth so the seeded bank feed loads;
// against a real backend it runs only for a signed-in, non-local session (needs a JWT).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { db } from '@/db'
import { isReadyToPush } from '@tracker-engine/local-first'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { bankSource } from './aggregation'
import { LedgerSyncEngine } from './engine'

export type SyncPhase = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  pending: number
  deadLettered: number
  enabled: boolean
  isMock: boolean
  phase: SyncPhase
  syncNow: () => Promise<void>
  retryFailed: () => Promise<number>
  eraseServerData: () => Promise<{ failed: { table: string; error: string }[] }>
  discardLocalChanges: () => Promise<{ discarded: number; applied: number }>
}

export function useSync(): SyncStatus {
  const { session } = useAuth()
  const [phase, setPhase] = useState<SyncPhase>('idle')

  const { engine, isMock } = useMemo(() => {
    const source = bankSource()
    return { engine: new LedgerSyncEngine(source.backend), isMock: source.isMock }
  }, [])

  // Mock mode always syncs (it's just moving seeded rows into Dexie). Real backend
  // needs a verified session's JWT.
  const active = isMock || (session != null && !session.isLocal)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

    let draining = false
    const push = () => {
      if (cancelled || isOffline() || draining) return
      draining = true
      void engine
        .drainUntilSettled()
        .catch((error) => console.warn('[sync] drain threw', error))
        .finally(() => {
          draining = false
        })
    }

    const reconcile = () => {
      if (cancelled || isOffline()) return
      engine
        .sync()
        // Auto-categorize freshly pulled bank transactions per the user's rules.
        .then(() => repo.applyRules())
        .catch((error) => console.warn('[sync] reconcile threw', error))
    }

    reconcile()

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
    if (!active) return
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
    if (!active) return 0
    setPhase('syncing')
    try {
      const count = await engine.retryDeadLettered()
      const { remaining } = await engine.drainUntilSettled()
      await engine.pull()
      setPhase(remaining > 0 ? 'error' : 'idle')
      return count
    } catch {
      setPhase('error')
      return 0
    }
  }, [active, engine])

  const eraseServerData = useCallback(async () => {
    if (!active) return { failed: [] }
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
    if (!active) return { discarded: 0, applied: 0 }
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

  const pending = useLiveQuery(
    async () => (await db.outbox.toArray()).filter(isReadyToPush).length,
    [],
    0,
  )
  const deadLettered = useLiveQuery(() => db.deadLetter.count(), [], 0)

  return {
    pending,
    deadLettered,
    enabled: active,
    isMock,
    phase,
    syncNow,
    retryFailed,
    eraseServerData,
    discardLocalChanges,
  }
}
