import { createElement, type ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthScope } from '../src/react/authScope'
import type { AuthProvider, Session } from '../src/types'

afterEach(cleanup)

const account = (userId: string): Session => ({
  userId,
  email: `${userId}@example.com`,
  displayName: userId,
  createdAt: 0,
  isVerified: true,
  isLocal: false,
})

function fakeProvider(initial: Session | null) {
  let listener: (session: Session | null) => void = () => {}
  const provider = {
    getSession: async () => initial,
    onSessionChange: (callback: (session: Session | null) => void) => {
      listener = callback
      return () => {}
    },
  } as unknown as AuthProvider
  return { provider, emit: (session: Session | null) => listener(session) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function scopeWith(provider: AuthProvider, applySession: (owner: string) => Promise<null>) {
  const scope = createAuthScope<null>({ provider, isLocalOnly: false, applySession })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(scope.AuthProviderScope, null, children)
  return { scope, wrapper }
}

describe('createAuthScope', () => {
  it('drops the old account before preparing the next one', async () => {
    const { provider, emit } = fakeProvider(account('a'))
    const preparingB = deferred<null>()
    const applySession = vi.fn((owner: string) =>
      owner === 'b' ? preparingB.promise : Promise.resolve(null),
    )
    const { scope, wrapper } = scopeWith(provider, applySession)
    const { result } = renderHook(() => scope.useAuth(), { wrapper })
    await waitFor(() => expect(result.current.session?.userId).toBe('a'))

    act(() => emit(account('b')))
    await waitFor(() => expect(applySession).toHaveBeenCalledWith('b', expect.anything()))
    expect(result.current.session).toBeNull()

    await act(async () => preparingB.resolve(null))
    await waitFor(() => expect(result.current.session?.userId).toBe('b'))
  })

  it('keeps the session when the same account signs in again', async () => {
    const { provider, emit } = fakeProvider(account('a'))
    const { scope, wrapper } = scopeWith(provider, async () => null)
    const seen: (string | null | undefined)[] = []
    renderHook(
      () => {
        const auth = scope.useAuth()
        seen.push(auth.session === undefined ? undefined : (auth.session?.userId ?? null))
      },
      { wrapper },
    )
    await waitFor(() => expect(seen.at(-1)).toBe('a'))
    await act(async () => emit(account('a')))
    expect(seen.filter((value) => value === null)).toEqual([])
  })
})
