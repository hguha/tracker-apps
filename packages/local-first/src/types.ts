// The generic sync scaffolding types, plus the ports the engine is injected with.
// These used to live in the app's db/database.ts; they're domain-agnostic, so they
// belong here and the app re-exports them.

/**
 * Durable mutation queue: one entry per dirty row, not a log of edits.
 *
 * The entry records *that* a row changed, never a copy of it — the drain reads the
 * row at push time, which makes a replay idempotent by construction and a second
 * edit to the same row refresh its entry instead of appending.
 */
export interface OutboxEntry {
  seq?: number
  table: string
  rowId: string
  queuedAt: number
  attempts: number
  lastError?: string
  nextAttemptAt?: number
  // An entry held back until some parent operation completes (in REPutation, a
  // workout still open for editing); the drain skips these. The name is
  // app-flavored for now to avoid a Dexie index migration — rename to `deferredFor`
  // when convenient.
  deferredForWorkoutId?: string
}

export const isReadyToPush = (entry: OutboxEntry): boolean =>
  entry.deferredForWorkoutId === undefined

/** Per-table high-water marks for delta pulls. */
export interface SyncState {
  table: string
  lastPulledAt: number
}

// A write the server refused, or that ran out of attempts — moved off the drain
// path so a poison write can't block the queue. Carries the row as it stood when it
// failed, plus how hard we tried, because that's what makes it diagnosable.
export interface DeadLetterEntry {
  seq?: number
  table: string
  rowId: string
  row: object
  queuedAt: number
  failedAt: number
  attempts: number
  error: string
}

// --- Injected ports -------------------------------------------------------------
// The engine talks to persistence and app services only through these, so
// @tracker-engine/local-first imports nothing from the app. The app builds a SyncDeps from
// its Dexie tables + repository (see the app's sync/deps.ts).

export interface OutboxPort {
  toArray(): Promise<OutboxEntry[]>
  delete(seq: number): Promise<void>
  update(seq: number, changes: Partial<OutboxEntry>): Promise<unknown>
  clear(): Promise<void>
  count(): Promise<number>
}

export interface DeadLetterPort {
  toArray(): Promise<DeadLetterEntry[]>
  delete(seq: number): Promise<void>
  clear(): Promise<void>
  count(): Promise<number>
}

export interface SyncStatePort {
  get(table: string): Promise<SyncState | undefined>
  put(state: SyncState): Promise<unknown>
  clear(): Promise<void>
}

export interface SyncDeps {
  outbox: OutboxPort
  deadLetter: DeadLetterPort
  syncState: SyncStatePort
  /** Atomically add to dead-letter and remove the outbox entry (one transaction). */
  moveToDeadLetter(outboxSeq: number, entry: Omit<DeadLetterEntry, 'seq'>): Promise<unknown>
  /** Re-queue a dead-lettered row through the app's normal enqueue path. */
  enqueue(table: string, rowId: string): Promise<unknown>
  /** Report a dead-letter for server-side diagnostics. */
  reportError(tag: string, error: Error): unknown
}
