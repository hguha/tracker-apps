/**
 * Sync logging (§5.5).
 *
 * Sync runs in the background and fails quietly by design — which is exactly why
 * "it just said failed to sync a bunch" is so hard to diagnose. This gives the
 * engine a single, structured, prefixed channel so a developer can watch the
 * drain/pull in the console and see *what* pushed, *what* failed, and *why*
 * (the classified reason and server message), not just a count.
 *
 * Off by default in production to avoid noise; on automatically in dev, and
 * flippable at runtime via `localStorage.fitnoteSyncDebug = '1'` or
 * `window.__fitnoteSyncDebug = true` so it can be turned on against the live app
 * without a rebuild.
 */

const PREFIX = '[sync]'

function enabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      if ((window as { __fitnoteSyncDebug?: boolean }).__fitnoteSyncDebug) return true
      if (window.localStorage?.getItem('fitnoteSyncDebug') === '1') return true
    }
  } catch {
    // localStorage can throw in private mode / sandboxed frames — ignore.
  }
  // import.meta.env.DEV is true under `vite dev`, false in a production build.
  return Boolean(import.meta.env?.DEV)
}

export const syncLog = {
  info(message: string, data?: unknown): void {
    if (!enabled()) return
    if (data === undefined) console.info(`${PREFIX} ${message}`)
    else console.info(`${PREFIX} ${message}`, data)
  },
  /** Warnings always surface — a failed push is worth seeing even in prod. */
  warn(message: string, data?: unknown): void {
    if (data === undefined) console.warn(`${PREFIX} ${message}`)
    else console.warn(`${PREFIX} ${message}`, data)
  },
}
