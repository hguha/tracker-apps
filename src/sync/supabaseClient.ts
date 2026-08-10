/**
 * The Supabase client singleton.
 *
 * Reads its URL and anon key from Vite env (`VITE_SUPABASE_URL`,
 * `VITE_SUPABASE_ANON_KEY`). When those are absent — the local-first prototype
 * with no project attached — `getSupabase()` returns null and the app runs
 * entirely against IndexedDB, exactly as it does today. Nothing here is imported
 * on the logging path; sync is opt-in and lazy.
 *
 * The anon key is public by design (RLS is what protects data, §4.13). No
 * service-role key ever reaches the client.
 */

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
      // A refresh failure while offline must not clear the session or IndexedDB
      // (§11.1) — persist and auto-refresh, and let the app treat a failed
      // refresh as an offline condition rather than a sign-out.
      persistSession: true,
      autoRefreshToken: true,
      // The magic link lands back on the app carrying its auth params; this is
      // what reads them, establishes the session, and fires SIGNED_IN. Without
      // it, clicking the link changes the URL but never logs you in.
      detectSessionInUrl: true,
      // Implicit flow puts the token directly in the URL hash, which
      // detectSessionInUrl consumes on load with no extra round trip — more
      // robust under a subpath deploy than PKCE's code-exchange step.
      flowType: 'implicit',
      // Persist under a fixed key so it's obvious which entry is ours, and so a
      // key change is a deliberate act rather than a silent library default.
      storageKey: 'fitnote.auth',
    },
  })

  // Strip the consumed auth hash from the URL.
  //
  // Implicit flow lands with `#access_token=…` and supabase-js reads it once. If
  // it stays in the address bar, the next reload hands `detectSessionInUrl` an
  // already-used token; that fails, and the failure clears the session — which
  // read as "it doesn't keep me logged in". The stored session is what should be
  // authoritative after the first load, so remove the hash once it's consumed.
  //
  // Done on SIGNED_IN rather than immediately, so it can't race the read.
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

/** Whether a Supabase project is configured for this build. */
export function isBackendConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )
}
