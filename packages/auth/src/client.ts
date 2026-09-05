// The anon key is public by design; RLS protects the data.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseClientConfig {
  url: string
  anonKey: string
  /** localStorage key for the persisted session — app-specific; keep stable across releases. */
  storageKey: string
}

export function createSupabaseClient(config: SupabaseClientConfig): SupabaseClient {
  const client = createClient(config.url, config.anonKey, {
    auth: {
      // A refresh failure while offline must not clear the session; treat it as offline.
      persistSession: true,
      autoRefreshToken: true,
      // Reads the magic link's auth params on landing and fires SIGNED_IN.
      detectSessionInUrl: true,
      // Implicit flow is more robust under a subpath deploy than PKCE's code-exchange step.
      flowType: 'implicit',
      storageKey: config.storageKey,
    },
  })

  // Strip the consumed auth hash: a leftover used token fails on the next reload and
  // clears the session. Done on SIGNED_IN rather than immediately so it can't race the read.
  client.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_IN') return
    if (typeof window === 'undefined') return
    if (!window.location.hash.includes('access_token')) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  })

  return client
}

/**
 * Memoized client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, or null when either
 * is unset so the app runs entirely against IndexedDB. `storageKey` is app-specific and
 * load-bearing — changing it signs every existing user out.
 */
export function supabaseSingleton(storageKey: string): () => SupabaseClient | null {
  let client: SupabaseClient | null | undefined
  return () => {
    if (client !== undefined) return client
    const { url, anonKey } = backendEnv()
    client = url && anonKey ? createSupabaseClient({ url, anonKey, storageKey }) : null
    return client
  }
}

export function isBackendConfigured(): boolean {
  const { url, anonKey } = backendEnv()
  return Boolean(url && anonKey)
}

// Read without depending on vite's ImportMeta types, so this package typechecks standalone.
function backendEnv(): { url?: string; anonKey?: string } {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return { url: env?.VITE_SUPABASE_URL, anonKey: env?.VITE_SUPABASE_ANON_KEY }
}
