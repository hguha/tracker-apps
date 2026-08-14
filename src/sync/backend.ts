// The one interface all server access goes through, so swapping Supabase is reimplementing this (§5.6).

// The row as it stands locally, read at push time. There is no insert/update
// distinction — the push is an upsert — and no delete: a soft-deleted row carries
// its own `deletedAt`, so a tombstone is just its current state.
export interface PushRow {
  table: string
  rowId: string
  row: Record<string, unknown>
}

export type PushOutcome =
  | { status: 'ok' }
  | { status: 'transient'; error: string }
  | { status: 'permanent'; error: string }
  | { status: 'auth'; error: string }

/** Tombstones (deleted_at set) are included so a delete propagates. */
export interface PulledRow {
  table: string
  row: Record<string, unknown>
}

export interface SyncBackend {
  /** Upsert on rowId, so a replayed push is harmless. */
  push(row: PushRow): Promise<PushOutcome>

  /** Every row with updated_at strictly greater than `since` (epoch ms), ascending. */
  pull(table: string, since: number): Promise<PulledRow[]>

  // A real DELETE for the "erase my data" path (§11.3) only — sync must never hard-delete,
  // since a removed row can't be represented in a delta pull and a peer would re-upload it.
  hardDeleteAll(table: string): Promise<{ ok: true } | { ok: false; error: string }>
}
