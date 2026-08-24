// The Supabase client singleton; returns null with no env configured, so the app
// runs entirely against IndexedDB. The anon key is public by design (RLS protects data, §4.13).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (!url || !anonKey) {
    client = null
    return client
  }

  client = createClient(url, anonKey, {
    auth: {
      // A refresh failure while offline must not clear the session (§11.1); treat it as offline.
      persistSession: true,
      autoRefreshToken: true,
      // Reads the magic link's auth params on landing and fires SIGNED_IN.
      detectSessionInUrl: true,
      // Implicit flow is more robust under a subpath deploy than PKCE's code-exchange step.
      flowType: 'implicit',
      storageKey: 'fitnote.auth',
    },
  })

  // Strip the consumed auth hash: a leftover used token fails on the next reload and clears the session.
  // Done on SIGNED_IN rather than immediately so it can't race the read.
  client.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_IN') return
    if (typeof window === 'undefined') return
    if (!window.location.hash.includes('access_token')) return
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    )
  })

  return client
}

export function isBackendConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )
}
