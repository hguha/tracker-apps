import { describe, expect, it, vi } from 'vitest'
import { createOwnerGuard, type OwnerStorage } from '../src/owner'

function table() {
  return { clear: vi.fn(async () => {}) }
}

function memoryStorage(): OwnerStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

function guard(claim?: (userId: string) => Promise<number>) {
  const tables = [table(), table()]
  return {
    tables,
    guard: createOwnerGuard({
      storageKey: 'test.owner',
      tables,
      claim,
      storage: memoryStorage(),
    }),
  }
}

describe('assertOwner', () => {
  it('adopts an unowned database rather than wiping it', async () => {
    const { guard: g, tables } = guard()
    expect(await g.assertOwner('user-a')).toBe(false)
    expect(tables[0]!.clear).not.toHaveBeenCalled()
    expect(g.currentOwner()).toBe('user-a')
  })

  it('adopts a device-only database, so pre-signup data survives', async () => {
    const { guard: g, tables } = guard()
    g.setOwner('local-user')
    expect(await g.assertOwner('user-a')).toBe(false)
    expect(tables[0]!.clear).not.toHaveBeenCalled()
  })

  it('wipes when the database belonged to a different real account', async () => {
    const { guard: g, tables } = guard()
    g.setOwner('user-a')
    expect(await g.assertOwner('user-b')).toBe(true)
    for (const t of tables) expect(t.clear).toHaveBeenCalledOnce()
    expect(g.currentOwner()).toBe('user-b')
  })

  it('does nothing when the owner is unchanged', async () => {
    const { guard: g, tables } = guard()
    g.setOwner('user-a')
    expect(await g.assertOwner('user-a')).toBe(false)
    expect(tables[0]!.clear).not.toHaveBeenCalled()
  })
})

describe('claimLocal', () => {
  it('delegates to the app and reports the row count', async () => {
    const claim = vi.fn(async () => 12)
    const { guard: g } = guard(claim)
    expect(await g.claimLocal('user-a')).toBe(12)
    expect(claim).toHaveBeenCalledWith('user-a')
  })

  it('claims nothing when the app opts out', async () => {
    const { guard: g } = guard()
    expect(await g.claimLocal('user-a')).toBe(0)
  })

  it('survives the guard running after a claim, which is the required order', async () => {
    const claim = vi.fn(async () => 5)
    const { guard: g, tables } = guard(claim)
    await g.claimLocal('user-a')
    g.setOwner('user-a')
    expect(await g.assertOwner('user-a')).toBe(false)
    expect(tables[0]!.clear).not.toHaveBeenCalled()
  })
})
