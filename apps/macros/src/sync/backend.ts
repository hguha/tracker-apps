import { SupabaseBackend, SyncEngine } from '@tracker-engine/local-first'
import { getSupabase } from '@/backend/supabaseClient'
import { macroSyncSchema } from './macroSchema'
import { macroSyncDeps } from './deps'

/**
 * This app's timestamptz columns beyond the engine's universal ones. Missing a column here
 * sends epoch milliseconds to Postgres, which rejects the whole push with "date/time field
 * value out of range" — every log entry silently dead-letters.
 */
export const TIMESTAMP_COLUMNS = ['eaten_at', 'verified_at', 'reached_at', 'target_at']

/** null with no project configured, which is what keeps the app fully usable offline. */
export function macroSyncEngine(): SyncEngine | null {
  const client = getSupabase()
  if (!client) return null
  const backend = new SupabaseBackend(client, { timestampColumns: TIMESTAMP_COLUMNS })
  return new SyncEngine(backend, macroSyncSchema, macroSyncDeps())
}
