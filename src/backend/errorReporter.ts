/**
 * First-party error reporting (§11.4): insert a scrubbed record into
 * `client_errors` instead of running a third-party SDK. Best-effort — anything
 * short of a signed-in caller with a working network drops the report silently.
 */

import { getSupabase } from '@/backend/supabaseClient'
import { APP_VERSION } from '@/lib/version'

export type ErrorContext =
  | 'error-boundary'
  | 'window-error'
  | 'unhandled-rejection'
  | 'sync-dead-letter'

// Same-payload dedupe so a render loop can't flood the table.
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

  // No auth.uid() → the insert would fail RLS anyway; don't leak error text either.
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
    // A failed report must never bubble into user-facing code.
  }
}

/** Routes window errors and unhandled rejections to the reporter. Idempotent. */
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
