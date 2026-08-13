// The Supabase implementation of `SyncBackend` (§5.5); the only file that knows PostgREST exists.

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
        // Soft delete (§4.11): a hard delete can't be represented in a pull-based sync.
        const { error } = await this.client
          .from(table)
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', row.rowId)
        return error ? classify(error) : { status: 'ok' }
      }

      // Upsert on the client-generated id, so a replayed write is idempotent (§5.5).
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

  async hardDeleteAll(
    table: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const pgTable = tableToPostgres(table)
    try {
      // "id is not null" is the total filter PostgREST needs (it refuses an
      // unfiltered DELETE); RLS still scopes the statement to the caller's own rows.
      const { error } = await this.client.from(pgTable).delete().not('id', 'is', null)
      return error ? { ok: false, error: error.message } : { ok: true }
    } catch (cause) {
      return { ok: false, error: String(cause) }
    }
  }
}

export function toPostgresRow(row: Record<string, unknown>): Record<string, unknown> {
  const snake = keysToSnake(row)
  for (const column of TIMESTAMP_COLUMNS) {
    if (column in snake && typeof snake[column] === 'number') {
      snake[column] = msToIso(snake[column] as number)
    }
  }
  return snake
}

function fromPostgresRow(row: Record<string, unknown>): Record<string, unknown> {
  const withMs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    withMs[key] =
      TIMESTAMP_COLUMNS.has(key) && typeof value === 'string' ? isoToMs(value) : value
  }
  return keysToCamel(withMs)
}

// Maps a PostgREST error to the engine's failure buckets off `code` (§5.5); there is no HTTP status.
export function classify(error: PostgrestError): PushOutcome {
  const code = error.code ?? ''

  // JWT errors and invalid-authorization SQLSTATEs pause for re-auth rather than dead-letter.
  if (code === 'PGRST301' || code === 'PGRST302' || code.startsWith('28')) {
    return { status: 'auth', error: error.message }
  }

  // A foreign-key violation means the parent row hasn't landed yet, which is an
  // ordering problem, not a rejection: the drain stops on transient and resumes
  // in seq order, which is exactly the repair. Dead-lettering it instead strands
  // the child permanently behind a parent that was about to arrive.
  if (code === '23503') {
    return { status: 'transient', error: error.message }
  }

  // Any other real SQLSTATE (RLS, unique, type, not-null) is a rejection retrying can't fix.
  if (/^[0-9]/.test(code)) {
    return { status: 'permanent', error: error.message }
  }

  // Any other PostgREST code (e.g. PGRST1xx schema/parse) is also unfixable by retry.
  if (code.startsWith('PGRST')) {
    return { status: 'permanent', error: error.message }
  }

  return { status: 'transient', error: error.message }
}
