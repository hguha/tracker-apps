/**
 * An in-memory sync backend for tests (§14.1).
 *
 * Models the server closely enough to exercise the engine's contract: it stores
 * rows by table+id, upserts on push, serves deltas by updatedAt, and lets a test
 * script arbitrary outcomes (transient, permanent, auth) to prove the engine's
 * failure classification, backoff, dead-lettering, and pending-write guard.
 */

import type { PulledRow, PushOutcome, PushRow, SyncBackend } from './backend'

type Store = Map<string, Map<string, Record<string, unknown>>>

export class MockBackend implements SyncBackend {
  private store: Store = new Map()
  private available = true

  /** Queue of forced outcomes; when empty, push succeeds. FIFO per call. */
  private forced: PushOutcome[] = []
  /** Every push seen, in order — for asserting drain order. */
  readonly pushed: PushRow[] = []

  /** Force the next N pushes to return this outcome, then resume succeeding. */
  forceNext(outcome: PushOutcome, times = 1): void {
    for (let i = 0; i < times; i += 1) this.forced.push(outcome)
  }

  setAvailable(available: boolean): void {
    this.available = available
  }

  async push(row: PushRow): Promise<PushOutcome> {
    this.pushed.push(row)
    const forced = this.forced.shift()
    if (forced && forced.status !== 'ok') return forced

    const table = this.store.get(row.table) ?? new Map()
    // Upsert on rowId — idempotent, so a replay is harmless.
    const existing = table.get(row.rowId) ?? {}
    table.set(row.rowId, { ...existing, ...row.payload, id: row.rowId })
    this.store.set(row.table, table)
    return { status: 'ok' }
  }

  async pull(table: string, since: number): Promise<PulledRow[]> {
    const rows = [...(this.store.get(table)?.values() ?? [])]
    return rows
      .filter((row) => Number(row.updatedAt ?? 0) > since)
      .sort((a, b) => Number(a.updatedAt ?? 0) - Number(b.updatedAt ?? 0))
      .map((row) => ({ table, row }))
  }

  async hardDeleteAll(
    table: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    // Model the FK cascade the real schema has, so a test sees children go too.
    const CASCADES: Record<string, string[]> = {
      workouts: ['workoutExercises', 'sets'],
      templates: ['templateExercises'],
    }
    this.store.delete(table)
    for (const child of CASCADES[table] ?? []) this.store.delete(child)
    return { ok: true }
  }

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  /** Test helper: seed a row directly as if another device had synced it. */
  seed(table: string, row: Record<string, unknown>): void {
    const t = this.store.get(table) ?? new Map()
    t.set(String(row.id), row)
    this.store.set(table, t)
  }

  /** Test helper: read a row back to assert what the server holds. */
  get(table: string, id: string): Record<string, unknown> | undefined {
    return this.store.get(table)?.get(id)
  }

  count(table: string): number {
    return this.store.get(table)?.size ?? 0
  }
}
