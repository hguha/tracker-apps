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
    const payload = toPostgresRow(row.payload, table)

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

  async hardDeleteAll(
    table: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const pgTable = tableToPostgres(table)
    try {
      // PostgREST refuses an unfiltered DELETE, so this needs a predicate that
      // matches every row. `id` is non-null on every synced table, so
      // "id is not null" is a total filter. RLS still scopes the statement to the
      // caller's own rows, so this can only ever erase your own data — and for
      // the shared library tables it can only touch rows you created (system
      // rows have user_id null and no delete policy matches them).
      const { error } = await this.client.from(pgTable).delete().not('id', 'is', null)
      return error ? { ok: false, error: error.message } : { ok: true }
    } catch (cause) {
      return { ok: false, error: String(cause) }
    }
  }
}

/**
 * Domain fields that are NOT columns on their Postgres table, and so must be
 * stripped from a push (§4.3).
 *
 * `secondary_muscles` is retained here even though the concept was removed from
 * the domain model: rows written by an older build still carry the field
 * locally, and sending it produced "Could not find the 'secondary_muscles'
 * column of 'exercises' in the schema cache" — a permanent failure that
 * dead-lettered every custom-exercise write. The guard costs nothing and
 * removing it would resurrect that bug for anyone with pre-existing rows.
 *
 * Keyed by Postgres table name, listing snake_case keys to drop.
 */
const NON_COLUMN_FIELDS: Record<string, readonly string[]> = {
  exercises: ['secondary_muscles'],
}

/** Domain row → Postgres row: snake_case keys, ISO timestamps, no stray fields. */
export function toPostgresRow(
  row: Record<string, unknown>,
  table: string,
): Record<string, unknown> {
  const snake = keysToSnake(row)
  for (const column of TIMESTAMP_COLUMNS) {
    if (column in snake && typeof snake[column] === 'number') {
      snake[column] = msToIso(snake[column] as number)
    }
  }
  // Drop anything the table has no column for, so one unmappable field can't
  // dead-letter the whole row.
  for (const field of NON_COLUMN_FIELDS[table] ?? []) delete snake[field]
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
 * Maps a PostgREST error to the engine's failure buckets (§5.5).
 *
 * `PostgrestError` carries no HTTP status — only `code` (a PostgREST code like
 * `PGRST301`, or a Postgres SQLSTATE like `42501`), `message`, `details`,
 * `hint`. An earlier version read a non-existent `.status`, so every failure
 * fell through to "transient" and the dead-letter / auth-pause paths never
 * fired. Classify off `code` instead:
 *   - JWT / auth codes (PGRST301/302, SQLSTATE 28xxx) → auth: pause for re-auth.
 *   - A concrete Postgres SQLSTATE (RLS 42501, unique 23505, check 23514, …) →
 *     permanent: the write can't succeed as-is, so dead-letter it rather than
 *     retry forever.
 *   - No code at all (a fetch/network throw surfaces upstream as a thrown
 *     error, but a codeless PostgrestError is treated as transient) → retry.
 */
export function classify(error: PostgrestError): PushOutcome {
  const code = error.code ?? ''

  // Auth: PostgREST JWT errors and Postgres invalid-authorization SQLSTATEs.
  if (code === 'PGRST301' || code === 'PGRST302' || code.startsWith('28')) {
    return { status: 'auth', error: error.message }
  }

  // A real SQLSTATE (5 chars, starts with a digit) is a definite server-side
  // rejection — RLS, constraint, type, not-null. Retrying can't fix it.
  if (/^[0-9]/.test(code)) {
    return { status: 'permanent', error: error.message }
  }

  // Any other PostgREST code (e.g. PGRST1xx schema/parse issues) is also a
  // request the client can't fix by retrying.
  if (code.startsWith('PGRST')) {
    return { status: 'permanent', error: error.message }
  }

  // No usable code — treat as transient and let backoff retry.
  return { status: 'transient', error: error.message }
}
