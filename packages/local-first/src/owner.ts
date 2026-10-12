export interface ClearableTable {
  clear(): Promise<unknown>
}

export interface OwnerGuardConfig {
  /** localStorage key holding the last owner. App-specific and load-bearing. */
  storageKey: string
  /** Every local table, cleared when the database belonged to a different real user. */
  tables: readonly ClearableTable[]
  /**
   * Re-own and re-enqueue device-only rows for the new user, returning how many moved.
   * Omit in apps where signing in should start clean instead of adopting local work.
   */
  claim?(userId: string): Promise<number>
  /** The owner id device-only rows carry. */
  localUserId?: string
  /** Defaults to localStorage; injectable so this works without a DOM. */
  storage?: OwnerStorage
}

export interface OwnerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface OwnerGuard {
  /**
   * Wipes the local database if it belonged to a *different real* account, and returns
   * whether it did. An unowned or device-only database is adopted, not wiped — someone who
   * logged data before signing up must not lose it.
   *
   * Call order matters: `claimLocal` (or `setOwner`) has to run before this, or the guard
   * wipes the rows that were just claimed.
   */
  assertOwner(ownerId: string): Promise<boolean>
  adopt(ownerId: string): Promise<{ wiped: boolean; claimed: number }>
  claimLocal(userId: string): Promise<number>
  setOwner(ownerId: string): void
  clearOwner(): void
  currentOwner(): string | null
}

export type OwnerTransition = { kind: 'claimed'; rows: number } | { kind: 'wiped-foreign' }

export const ownerTransition = (adopted: {
  wiped: boolean
  claimed: number
}): OwnerTransition | null => {
  if (adopted.wiped) return { kind: 'wiped-foreign' }
  return adopted.claimed > 0 ? { kind: 'claimed', rows: adopted.claimed } : null
}

export function createOwnerGuard(config: OwnerGuardConfig): OwnerGuard {
  const localUserId = config.localUserId ?? 'local-user'
  const store = config.storage ?? (typeof localStorage === 'undefined' ? null : localStorage)

  const read = (): string | null => {
    try {
      return store?.getItem(config.storageKey) ?? null
    } catch {
      return null
    }
  }

  const write = (value: string | null): void => {
    try {
      if (value === null) store?.removeItem(config.storageKey)
      else store?.setItem(config.storageKey, value)
    } catch {
      // Safari private mode throws. Failing to record ownership must not break sign-in;
      // the cost is a redundant adopt next launch, not data loss.
    }
  }

  const assertOwner = async (ownerId: string): Promise<boolean> => {
    const previous = read()
    if (previous === ownerId) return false

    const isForeign = previous !== null && previous !== localUserId
    if (isForeign) await Promise.all(config.tables.map((table) => table.clear()))
    write(ownerId)
    return isForeign
  }

  const claimLocal = (userId: string): Promise<number> =>
    userId === localUserId ? Promise.resolve(0) : (config.claim?.(userId) ?? Promise.resolve(0))

  return {
    assertOwner,
    async adopt(ownerId) {
      const wiped = await assertOwner(ownerId)
      return { wiped, claimed: await claimLocal(ownerId) }
    },
    claimLocal,
    setOwner: write,
    clearOwner: () => write(null),
    currentOwner: read,
  }
}
