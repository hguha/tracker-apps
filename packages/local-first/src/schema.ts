// The domain-specific configuration the (otherwise generic) SyncEngine is driven by.
//
// Everything that once hardcoded "workout" in the engine — which tables sync and in
// what order, the parent chain that enforces foreign keys, per-row backfills for
// pulled rows, the store behind each table, and the erase order — comes from a
// SyncSchema. Each app supplies its own and reuses the engine unchanged.

export interface SyncRowStore {
  put(row: Record<string, unknown>): Promise<unknown>
  get(id: string): Promise<Record<string, unknown> | undefined>
}

export interface SyncSchema {
  /** Tables that participate in sync, in dependency order (parents before children). */
  readonly tables: readonly string[]

  /**
   * The rowId of the parent this row hangs off, or undefined if it stands alone.
   * The drain uses it to keep a child from being sent — or dead-lettered — ahead of
   * its parent. Returns the id only (the engine keys its rejected/blocked sets by rowId).
   */
  parentIdOf(table: string, row: Record<string, unknown>): string | undefined

  /**
   * Backfill domain fields a pulled row can't carry from Postgres (e.g. a missing
   * array that would throw on iterate). Identity when omitted.
   */
  normalize?(table: string, row: Record<string, unknown>): Record<string, unknown>

  /** The local (Dexie) store for a synced table. */
  store(table: string): SyncRowStore

  /**
   * Order to hard-delete server rows in for the "erase my data" path: children
   * before parents, and excluding shared/system tables that must survive.
   */
  readonly eraseOrder: readonly string[]

  /**
   * Tables the SERVER authors (e.g. bank transactions pulled via aggregation): the
   * drain never pushes these, pull applies them. Empty when the client authors
   * everything. User edits to server rows belong in a separate client-authored
   * overlay table, so the "server wins unless local pending" rule still holds.
   */
  readonly serverAuthored?: readonly string[]
}
