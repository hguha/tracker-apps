import { SupabaseBackend, type SyncBackend } from '@tracker-engine/local-first'
import { getSupabase } from '@/backend/supabaseClient'

/** null with no project configured, which is what keeps the app fully usable offline. */
export function syncBackend(): SyncBackend | null {
  const client = getSupabase()
  return client ? new SupabaseBackend(client) : null
}
