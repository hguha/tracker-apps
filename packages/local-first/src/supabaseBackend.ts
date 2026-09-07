// The Supabase implementation of `SyncBackend`; the only file that knows PostgREST exists.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { PulledRow, PushOutcome, PushRow, SyncBackend } from './backend'
import {
  DEFAULT_TIMESTAMP_COLUMNS,
  isoToMs,
  keysToCamel,
  keysToSnake,
  msToIso,
  tableToPostgres,
} from './columnCase'

export interface SupabaseBackendOptions {
  /**
   * Extra `timestamptz` columns this app has, beyond the universal ones. Anything a schema
   * declares as timestamptz but the domain models as epoch milliseconds must be listed, or the
   * push is rejected with "date/time field value out of range".
   */
  timestampColumns?: Iterable<string>
}

export class SupabaseBackend implements SyncBackend {
  private timestamps: Set<string>

  constructor(
    private client: SupabaseClient,
    options: SupabaseBackendOptions = {},
  ) {
    this.timestamps = new Set([
      ...DEFAULT_TIMESTAMP_COLUMNS,
      ...(options.timestampColumns ?? []),
    ])
  }

  async push(row: PushRow): Promise<PushOutcome> {
    const table = tableToPostgres(row.table)
    try {
      // Upsert on the client-generated id, so a replayed write is idempotent.
      // The full row, not a diff: the upsert re-checks the INSERT policy, and a
      // partial tuple lacks user_id, which RLS then rejects.
      const { error } = await this.client
        .from(table)
        .upsert({ ...toPostgresRow(row.row, this.timestamps), id: row.rowId }, { onConflict: 'id' })
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
      row: fromPostgresRow(row as Record<string, unknown>, this.timestamps),
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

export function toPostgresRow(
  row: Record<string, unknown>,
  timestamps: Set<string> = DEFAULT_TIMESTAMP_COLUMNS,
): Record<string, unknown> {
  const snake = keysToSnake(row)
  for (const column of timestamps) {
    if (column in snake && typeof snake[column] === 'number') {
      snake[column] = msToIso(snake[column] as number)
    }
  }
  return snake
}

function fromPostgresRow(
  row: Record<string, unknown>,
  timestamps: Set<string>,
): Record<string, unknown> {
  const withMs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    withMs[key] = timestamps.has(key) && typeof value === 'string' ? isoToMs(value) : value
  }
  return keysToCamel(withMs)
}

// Maps a PostgREST error to the engine's failure buckets off `code`; there is no HTTP status.
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
