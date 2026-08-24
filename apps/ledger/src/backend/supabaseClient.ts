// The Supabase client singleton for Ledger: reads env, memoizes, and pins the app's
// storage key. Client-creation mechanics live in @tracker-engine/auth; this keeps the
// env + storage key (a load-bearing identifier) app-side. Returns null when no env is
// configured, so the app runs entirely against IndexedDB + the mock bank feed.

import { createSupabaseClient } from '@tracker-engine/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (!url || !anonKey) {
    client = null
    return client
  }

  client = createSupabaseClient({ url, anonKey, storageKey: 'ledger.auth' })
  return client
}

export function isBackendConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )
}
