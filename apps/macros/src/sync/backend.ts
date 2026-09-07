import { SupabaseBackend, type SyncBackend } from '@tracker-engine/local-first'
import { getSupabase } from '@/backend/supabaseClient'

/**
 * This app's timestamptz columns beyond the engine's universal ones. Missing a column here
 * sends epoch milliseconds to Postgres, which rejects the whole push with "date/time field
 * value out of range" — every log entry silently dead-letters.
 */
const TIMESTAMP_COLUMNS = ['eaten_at', 'verified_at']

/** null with no project configured, which is what keeps the app fully usable offline. */
export function syncBackend(): SyncBackend | null {
  const client = getSupabase()
  return client ? new SupabaseBackend(client, { timestampColumns: TIMESTAMP_COLUMNS }) : null
}
