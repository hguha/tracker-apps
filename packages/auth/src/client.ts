// Supabase client factory. The app owns env reading, the storage key, and any
// singleton caching — this just applies the auth options and the SIGNED_IN hash
// strip. The anon key is public by design (RLS protects data).

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
