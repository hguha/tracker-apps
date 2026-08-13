/**
 * First-party error reporting (§11.4).
 *
 * §11.4 forbids a third-party error SDK because the app holds health-adjacent
 * data. So instead of Sentry we insert a scrubbed record into `client_errors`
 * (migration 0020). The client can INSERT but cannot SELECT; developer reads
 * happen through the service role in the dashboard. The row cascades away on
 * account deletion.
 *
 * Best-effort by design. If the network fails, the client isn't signed in, or
 * the backend isn't configured, we drop the report silently — the console log
 * is still there for whoever is looking.
 *
 * Signed-out and device-only sessions do not report. RLS would reject those
 * inserts anyway (auth.uid() is null), and it keeps privacy tight: a user who
 * hasn't opted into an account never leaks anything, including error text.
 */

import { getSupabase } from '@/sync/supabaseClient'

export type ErrorContext =
  | 'error-boundary'
  | 'window-error'
  | 'unhandled-rejection'

// A short, stable identifier for the running build — set at build time by Vite
// (see vite.config.ts). Falls back to 'dev' under `vite dev`.
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev'

// A cheap same-payload dedupe so a render loop doesn't flood the table.
const recentKeys = new Map<string, number>()
const DEDUPE_WINDOW_MS = 60_000
const MAX_MESSAGE_LEN = 4_000
const MAX_STACK_LEN = 16_000

function truncate(text: string | null | undefined, limit: number): string | null {
  if (!text) return null
  return text.length > limit ? text.slice(0, limit) : text
}

function shouldSuppress(key: string): boolean {
  const now = Date.now()
  for (const [k, t] of recentKeys) {
    if (now - t > DEDUPE_WINDOW_MS) recentKeys.delete(k)
  }
  const last = recentKeys.get(key)
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true
  recentKeys.set(key, now)
  return false
}

export async function reportError(
  context: ErrorContext,
  error: unknown,
): Promise<void> {
  const client = getSupabase()
  if (!client) return

  // A signed-out or device-only caller has no auth.uid() and would fail RLS.
  const { data } = await client.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) return

  const message = truncate(
    error instanceof Error ? error.message : String(error ?? 'unknown error'),
    MAX_MESSAGE_LEN,
  )!
  const stack = truncate(error instanceof Error ? error.stack : null, MAX_STACK_LEN)

  const key = `${context}:${message}`
  if (shouldSuppress(key)) return

  try {
    await client.from('client_errors').insert({
      user_id: userId,
      app_version: APP_VERSION,
      context,
      message,
      stack,
      url: typeof window !== 'undefined' ? window.location.href : null,
      user_agent:
        typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
    })
  } catch {
    // Fire-and-forget: reporting failures must never bubble into user-facing code.
  }
}

/**
 * Wires window-level error and unhandled-rejection handlers to the reporter.
 * Idempotent — safe to call once from main.tsx.
 */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return
  if ((window as unknown as { __fitnoteErrorHandlersInstalled?: boolean })
    .__fitnoteErrorHandlersInstalled)
    return
  ;(window as unknown as { __fitnoteErrorHandlersInstalled?: boolean })
    .__fitnoteErrorHandlersInstalled = true

  window.addEventListener('error', (event) => {
    void reportError('window-error', event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    void reportError('unhandled-rejection', event.reason)
  })
}
