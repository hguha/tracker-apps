/**
 * Which account the local database belongs to (§11.1.3).
 *
 * **This is a security boundary, not bookkeeping.** IndexedDB reads are not
 * scoped by user — `listWorkouts` and friends query the whole table, because for
 * one account that's both correct and much faster than filtering every row. The
 * server's RLS cannot help here: nothing about reading a cached row involves the
 * server at all.
 *
 * So the invariant is that the local database only ever holds **one** account's
 * data at a time. This records whose, in localStorage rather than IndexedDB so it
 * survives the wipe it triggers, and `assertOwner` enforces it: signing in as a
 * different account wipes the database before that account's tree can read a row.
 *
 * Without this, signing out and signing in as someone else showed the previous
 * account's workouts under the new account's name.
 */

const OWNER_KEY = 'fitnote.dbOwner'

/** The account the local database currently holds data for, if known. */
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

const ONBOARDED_KEY = 'fitnote.onboarded'

/**
 * Whether this account has completed first-run setup (§11.1.3).
 *
 * Per-account rather than per-device, so signing in on a second device doesn't
 * re-ask, and a genuinely new account on a shared device still gets the flow.
 */
export function hasOnboarded(userId: string): boolean {
  try {
    return localStorage.getItem(`${ONBOARDED_KEY}.${userId}`) === '1'
  } catch {
    // Can't tell — assume yes rather than trapping the user in setup.
    return true
  }
}

export function markOnboarded(userId: string): void {
  try {
    localStorage.setItem(`${ONBOARDED_KEY}.${userId}`, '1')
  } catch {
    /* ignore */
  }
}
