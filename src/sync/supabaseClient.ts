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
    },
  })
  return client
}

/** Whether a Supabase project is configured for this build. */
export function isBackendConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )
}
