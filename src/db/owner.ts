// Which account the local database belongs to (§11.1.3). Security boundary, not bookkeeping:
// IndexedDB reads aren't scoped by user, so the invariant is the DB holds exactly one account's
// data at a time. Stored in localStorage (not IndexedDB) so it survives the wipe it triggers.

const OWNER_KEY = 'fitnote.dbOwner'

export function getDbOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    // Private mode / sandboxed frame: treat as unknown rather than crashing.
    return null
  }
}

export function setDbOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId)
  } catch {
    // If we can't record the owner we also can't enforce the guard, but failing
    // the write is not a reason to block sign-in.
  }
}

export function clearDbOwner(): void {
  try {
    localStorage.removeItem(OWNER_KEY)
  } catch {
    /* ignore */
  }
}
