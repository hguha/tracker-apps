/**
 * The sync backend interface (§5.5, §5.6).
 *
 * All server access goes through this one interface, so swapping Supabase for
 * PowerSync or anything else is reimplementing this rather than touching the
 * engine or any screen. The engine below is written entirely against these three
 * methods; the tests run it against an in-memory fake.
 */

/** One row to push. Payload is the changed fields plus its primary key. */
export interface PushRow {
  table: string
  op: 'insert' | 'update' | 'delete'
  rowId: string
  payload: Record<string, unknown>
}

/** How the server classified a push, so the engine knows retry vs dead-letter. */
export type PushOutcome =
  | { status: 'ok' }
  /** 5xx / network — transient. The engine backs off and retries. */
  | { status: 'transient'; error: string }
  /** 4xx other than 401/429 — permanent. The engine dead-letters the entry. */
  | { status: 'permanent'; error: string }
  /** 401 — auth expired. The engine pauses until re-auth, does not dead-letter. */
  | { status: 'auth'; error: string }

/** A row pulled from the server during a delta pull. Tombstones included. */
export interface PulledRow {
  table: string
  row: Record<string, unknown>
}

export interface SyncBackend {
  /**
   * Applies one row as an upsert (insert/update) or soft-delete on the server.
   * Idempotent on rowId, so a replayed push is harmless.
   */
  push(row: PushRow): Promise<PushOutcome>

  /**
   * Returns every row in `table` whose updated_at is strictly greater than
   * `since` (epoch ms), ordered ascending. Tombstones (deleted_at set) are
   * included so a delete propagates.
   */
  pull(table: string, since: number): Promise<PulledRow[]>

  /** Whether the backend is currently reachable and authenticated. */
  isAvailable(): Promise<boolean>
}
