import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { db } from '@/db'
import { useAuth } from '@/auth/AuthContext'
import { MacroSyncEngine } from './engine'
import { syncBackend } from './backend'

export type SyncPhase = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  pending: number
  deadLettered: number
  enabled: boolean
  phase: SyncPhase
  syncNow: () => Promise<void>
}

export function useSync(): SyncStatus {
  const { session } = useAuth()
  const [phase, setPhase] = useState<SyncPhase>('idle')

  const engine = useMemo(() => {
    const backend = syncBackend()
    return backend ? new MacroSyncEngine(backend) : null
  }, [])

  // A device-only session has no JWT, so there is nothing to sync it to.
  const enabled = engine !== null && session != null && !session.isLocal

  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const deadLettered = useLiveQuery(() => db.deadLetter.count(), [], 0)

  const syncNow = useCallback(async () => {
    if (!engine || !enabled) return
    setPhase('syncing')
    try {
      await engine.sync()
      setPhase('idle')
    } catch {
      setPhase('error')
    }
  }, [engine, enabled])

  // Push on every outbox write; reconcile on open, foreground and coming back online.
  // Never on a timer, so a backgrounded app costs nothing.
  useEffect(() => {
    if (!engine || !enabled) return
    let cancelled = false
    let draining = false
    const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

    const push = () => {
      if (cancelled || draining || isOffline()) return
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
      void engine.sync().catch((error) => console.warn('[sync] reconcile threw', error))
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
  }, [enabled, engine])

  return { pending: pending ?? 0, deadLettered: deadLettered ?? 0, enabled, phase, syncNow }
}
