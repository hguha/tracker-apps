import type { SupabaseClient } from '@supabase/supabase-js'

export type ErrorContext =
  | 'error-boundary'
  | 'window-error'
  | 'unhandled-rejection'
  | 'sync-dead-letter'
  | (string & {})

export interface ErrorReporter {
  reportError(context: ErrorContext, error: unknown): Promise<void>
  installGlobalErrorHandlers(): void
}

const DEDUPE_WINDOW_MS = 60_000
const MAX_MESSAGE_LEN = 4_000
const MAX_STACK_LEN = 16_000

const truncate = (text: string | null | undefined, limit: number): string | null =>
  text ? text.slice(0, limit) : null

export function createErrorReporter(config: {
  client: () => SupabaseClient | null
  appVersion: string
  now?: () => number
}): ErrorReporter {
  const now = config.now ?? Date.now
  const recent = new Map<string, number>()
  let isInstalled = false

  const isDuplicate = (key: string): boolean => {
    const at = now()
    for (const [seen, time] of recent) if (at - time > DEDUPE_WINDOW_MS) recent.delete(seen)
    if (recent.has(key)) return true
    recent.set(key, at)
    return false
  }

  async function reportError(context: ErrorContext, error: unknown): Promise<void> {
    const client = config.client()
    if (!client) return
    const { data } = await client.auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return

    const message = truncate(
      error instanceof Error ? error.message : String(error ?? 'unknown error'),
      MAX_MESSAGE_LEN,
    )!
    if (isDuplicate(`${context}:${message}`)) return

    try {
      const { error: insertError } = await client.from('client_errors').insert({
        user_id: userId,
        app_version: config.appVersion,
        context,
        message,
        stack: truncate(error instanceof Error ? error.stack : null, MAX_STACK_LEN),
        url: typeof window === 'undefined' ? null : window.location.origin + window.location.pathname,
        user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 500),
      })
      if (insertError) console.warn('[errors] report rejected', insertError.message)
    } catch (cause) {
      console.warn('[errors] report failed', cause)
    }
  }

  return {
    reportError,
    installGlobalErrorHandlers() {
      if (isInstalled || typeof window === 'undefined') return
      isInstalled = true
      window.addEventListener('error', (event) => {
        void reportError('window-error', event.error ?? event.message)
      })
      window.addEventListener('unhandledrejection', (event) => {
        void reportError('unhandled-rejection', event.reason)
      })
    },
  }
}
