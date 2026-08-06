/**
 * The Supabase implementation of `SyncBackend` (§5.5, Phase 5).
 *
 * This is the only file that knows PostgREST exists. It translates a domain row
 * (camelCase, epoch-ms timestamps) to Postgres shape (snake_case, ISO
 * timestamps) and back, classifies HTTP outcomes into the engine's transient /
 * permanent / auth buckets, and pulls deltas by `updated_at`.
 *
 * The engine and every screen are unaware of it — swapping in PowerSync means
 * writing a sibling of this file and nothing else (§5.6).
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { PulledRow, PushOutcome, PushRow, SyncBackend } from './backend'
import {
  isoToMs,
  keysToCamel,
  keysToSnake,
  msToIso,
  TIMESTAMP_COLUMNS,
  tableToPostgres,
} from './columnCase'

export class SupabaseBackend implements SyncBackend {
  constructor(private client: SupabaseClient) {}

  async push(row: PushRow): Promise<PushOutcome> {
    const table = tableToPostgres(row.table)
    const payload = toPostgresRow(row.payload)

    try {
      if (row.op === 'delete') {
        // Deletes are soft (§4.11) — a hard delete can't be represented in a
        // pull-based sync. The repository already writes deletedAt; a delete op
        // here is belt-and-braces and also upserts the tombstone.
        const { error } = await this.client
          .from(table)
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', row.rowId)
        return error ? classify(error) : { status: 'ok' }
      }

      // Insert and update are both upserts on the client-generated id, so a
      // replayed write is idempotent (§5.5).
      const { error } = await this.client
        .from(table)
        .upsert({ ...payload, id: row.rowId }, { onConflict: 'id' })
      return error ? classify(error) : { status: 'ok' }
    } catch (cause) {
      // A thrown error (network down, DNS) is always transient.
      return { status: 'transient', error: String(cause) }
    }
  }

  async pull(table: string, since: number): Promise<PulledRow[]> {
    const pgTable = tableToPostgres(table)
    const { data, error } = await this.client
      .from(pgTable)
      .select('*')
      .gt('updated_at', new Date(since).toISOString())
      .order('updated_at', { ascending: true })

    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({
      table,
      row: fromPostgresRow(row as Record<string, unknown>),
    }))
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { error } = await this.client.rpc('keep_alive')
      // A missing RPC still proves reachability; only a network throw means down.
      return error === null || error.code !== undefined
    } catch {
      return false
    }
  }
}

/** Domain row → Postgres row: snake_case keys, ISO timestamps. */
function toPostgresRow(row: Record<string, unknown>): Record<string, unknown> {
  const snake = keysToSnake(row)
  for (const column of TIMESTAMP_COLUMNS) {
    if (column in snake && typeof snake[column] === 'number') {
      snake[column] = msToIso(snake[column] as number)
    }
  }
  return snake
}

/** Postgres row → domain row: camelCase keys, epoch-ms timestamps. */
function fromPostgresRow(row: Record<string, unknown>): Record<string, unknown> {
  const withMs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    withMs[key] =
      TIMESTAMP_COLUMNS.has(key) && typeof value === 'string' ? isoToMs(value) : value
  }
  return keysToCamel(withMs)
}

/**
 * Maps a PostgREST error to the engine's failure buckets (§5.5):
 *   - 401              → auth (pause for re-auth, never dead-letter)
 *   - 429 / 5xx / none → transient (back off and retry)
 *   - other 4xx        → permanent (dead-letter; the write can't succeed as-is)
 */
function classify(error: PostgrestError): PushOutcome {
  const code = Number((error as { status?: number }).status ?? 0)
  if (code === 401) return { status: 'auth', error: error.message }
  if (code === 429 || code >= 500 || code === 0) {
    return { status: 'transient', error: error.message }
  }
  if (code >= 400) return { status: 'permanent', error: error.message }
  // No HTTP status (e.g. a PostgREST-level constraint message) — treat a
  // constraint/validation error as permanent, anything else as transient.
  return error.code ? { status: 'permanent', error: error.message } : { status: 'transient', error: error.message }
}
