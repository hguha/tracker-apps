import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { SyncEngine } from './engine'

export type SyncPhase = 'idle' | 'syncing' | 'error'

export interface SyncCounts {
  pending: number
  deferred: number
  deadLettered: number
}

export interface SyncStatus extends SyncCounts {
  enabled: boolean
  phase: SyncPhase
  hasReconciled: boolean
  syncNow(): Promise<boolean>
  retryFailed(): Promise<{ count: number; isComplete: boolean }>
  eraseServerData(): Promise<{ failed: { table: string; error: string }[] }>
  discardLocalChanges(): Promise<{ discarded: number; applied: number }>
  uploadEverything(
    onProgress?: (progress: { pushed: number; remaining: number }) => void,
  ): Promise<{ pushed: number; deadLettered: number; remaining: number }>
}

export interface SyncScopeConfig {
  tag: string
  createEngine(): SyncEngine | null
  useSyncingUserId(): string | null
  useCounts(): SyncCounts
  observeOutbox(onCount: (count: number) => void): () => void
  claimOwnership?(userId: string): Promise<number>
  afterReconcile?(): Promise<unknown>
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false

export function createSyncScope(config: SyncScopeConfig) {
  const Context = createContext<SyncStatus | null>(null)
  const warn = (what: string, error: unknown) => console.warn(`[${config.tag}] ${what}`, error)

  function useSyncEngine(): SyncStatus {
    const engine = useMemo(() => config.createEngine(), [])
    const userId = config.useSyncingUserId()
    const enabled = engine !== null && userId !== null
    const counts = config.useCounts()
    const [phase, setPhase] = useState<SyncPhase>('idle')
    const [hasReconciled, setHasReconciled] = useState(false)

    useEffect(() => {
      if (!engine || !enabled) return
      let cancelled = false
      let draining = false

      const push = () => {
        if (cancelled || draining || isOffline()) return
        draining = true
        void engine
          .drainUntilSettled()
          .catch((error) => warn('drain threw', error))
          .finally(() => {
            draining = false
          })
      }

      const reconcile = () => {
        if (cancelled || isOffline()) return
        void engine
          .sync()
          .then(() => config.afterReconcile?.())
          .catch((error) => warn('reconcile threw', error))
          .finally(() => {
            if (!cancelled) setHasReconciled(true)
          })
      }

      reconcile()
      const unsubscribe = config.observeOutbox((count) => {
        if (count > 0) push()
      })
      const onVisible = () => {
        if (document.visibilityState === 'visible') reconcile()
      }
      window.addEventListener('online', reconcile)
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        cancelled = true
        unsubscribe()
        window.removeEventListener('online', reconcile)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }, [engine, enabled])

    const run = useCallback(
      async <T>(
        what: string,
        work: (engine: SyncEngine) => Promise<T>,
        failed: T,
        isIncomplete: (result: T) => boolean = () => false,
      ) => {
        if (!engine || !enabled) return failed
        setPhase('syncing')
        try {
          const result = await work(engine)
          setPhase(isIncomplete(result) ? 'error' : 'idle')
          return result
        } catch (error) {
          warn(`${what} failed`, error)
          setPhase('error')
          return failed
        }
      },
      [engine, enabled],
    )

    const settle = async (engine: SyncEngine): Promise<number> => {
      const { remaining } = await engine.drainUntilSettled()
      await engine.pull()
      return remaining
    }

    return {
      ...counts,
      enabled,
      phase,
      hasReconciled: !enabled || hasReconciled,
      syncNow: async () => (await run('sync', settle, -1, (remaining) => remaining !== 0)) === 0,
      retryFailed: async () => {
        const result = await run(
          'retry',
          async (engine) => {
            const claimed = (await config.claimOwnership?.(userId!)) ?? 0
            const requeued = await engine.retryDeadLettered()
            return { count: claimed + requeued, remaining: await settle(engine) }
          },
          { count: 0, remaining: -1 },
          ({ remaining }) => remaining !== 0,
        )
        return { count: result.count, isComplete: result.remaining === 0 }
      },
      eraseServerData: () =>
        run(
          'erase',
          (engine) => engine.hardDeleteServerData(),
          { failed: [{ table: 'unknown', error: 'sync is unavailable' }] },
          (result) => result.failed.length > 0,
        ),
      discardLocalChanges: () =>
        run('discard', (engine) => engine.discardLocalChanges(), { discarded: 0, applied: 0 }),
      uploadEverything: (onProgress) =>
        run(
          'upload',
          async (engine) => {
            await config.claimOwnership?.(userId!)
            return engine.drainUntilSettled({ onProgress })
          },
          { pushed: 0, deadLettered: 0, remaining: 0 },
          (result) => result.remaining > 0,
        ),
    }
  }

  function SyncScope({ children }: { children: ReactNode }) {
    return createElement(Context.Provider, { value: useSyncEngine() }, children)
  }

  function useSyncStatus(): SyncStatus {
    const status = useContext(Context)
    if (!status) throw new Error('useSyncStatus needs a SyncScope above it')
    return status
  }

  return { SyncScope, useSyncStatus }
}
