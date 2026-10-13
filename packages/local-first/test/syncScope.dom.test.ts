import { createElement, type ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncEngine } from '../src/engine'
import { createSyncScope, type SyncScopeConfig } from '../src/react'

afterEach(cleanup)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(engine: Partial<Record<keyof SyncEngine, unknown>>, overrides: Partial<SyncScopeConfig> = {}) {
  const createEngine = vi.fn(() => engine as unknown as SyncEngine)
  const scope = createSyncScope({
    tag: 'test',
    createEngine,
    useSyncingUserId: () => 'user-a',
    useCounts: () => ({ pending: 0, deferred: 0, deadLettered: 0 }),
    observeOutbox: () => () => {},
    ...overrides,
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(scope.SyncScope, null, children)
  return { scope, wrapper, createEngine }
}

const idleEngine = () => ({
  sync: vi.fn(async () => ({ drain: {}, pull: { applied: 0 } })),
  drainUntilSettled: vi.fn(async () => ({ pushed: 0, deadLettered: 0, remaining: 0 })),
  pull: vi.fn(async () => ({ applied: 0 })),
  retryDeadLettered: vi.fn(async () => 2),
})

describe('createSyncScope', () => {
  it('builds one engine however many screens read the status', () => {
    const { scope, wrapper, createEngine } = setup(idleEngine())
    renderHook(
      () => {
        scope.useSyncStatus()
        scope.useSyncStatus()
      },
      { wrapper },
    )
    expect(createEngine).toHaveBeenCalledTimes(1)
  })

  it('reports reconciled only once the first sync has finished', async () => {
    const first = deferred()
    const engine = { ...idleEngine(), sync: vi.fn(() => first.promise) }
    const { scope, wrapper } = setup(engine)
    const { result } = renderHook(() => scope.useSyncStatus(), { wrapper })
    expect(result.current.hasReconciled).toBe(false)

    await act(async () => first.resolve())
    await waitFor(() => expect(result.current.hasReconciled).toBe(true))
  })

  it('counts as reconciled straight away when sync is off', () => {
    const { scope, wrapper } = setup(idleEngine(), { useSyncingUserId: () => null })
    const { result } = renderHook(() => scope.useSyncStatus(), { wrapper })
    expect(result.current.enabled).toBe(false)
    expect(result.current.hasReconciled).toBe(true)
  })

  it('says whether sync now finished', async () => {
    const engine = idleEngine()
    const { scope, wrapper } = setup(engine)
    const { result } = renderHook(() => scope.useSyncStatus(), { wrapper })
    await act(async () => expect(await result.current.syncNow()).toBe(true))

    engine.drainUntilSettled.mockResolvedValueOnce({ pushed: 0, deadLettered: 0, remaining: 3 })
    await act(async () => expect(await result.current.syncNow()).toBe(false))
    expect(result.current.phase).toBe('error')
  })

  it('re-claims ownership before retrying failed rows', async () => {
    const order: string[] = []
    const engine = {
      ...idleEngine(),
      retryDeadLettered: vi.fn(async () => {
        order.push('retry')
        return 2
      }),
    }
    const claimOwnership = vi.fn(async () => {
      order.push('claim')
      return 1
    })
    const { scope, wrapper } = setup(engine, { claimOwnership })
    const { result } = renderHook(() => scope.useSyncStatus(), { wrapper })

    let outcome: { count: number; isComplete: boolean } | undefined
    await act(async () => {
      outcome = await result.current.retryFailed()
    })
    expect(claimOwnership).toHaveBeenCalledWith('user-a')
    expect(order).toEqual(['claim', 'retry'])
    expect(outcome).toEqual({ count: 3, isComplete: true })
  })
})
