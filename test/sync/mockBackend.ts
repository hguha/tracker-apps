/**
 * An in-memory sync backend for tests (§14.1).
 *
 * Models the server closely enough to exercise the engine's contract: it stores
 * rows by table+id, upserts on push, serves deltas by updatedAt, and lets a test
 * script arbitrary outcomes (transient, permanent, auth) to prove the engine's
 * failure classification, backoff, dead-lettering, and pending-write guard.
 */

import type { PulledRow, PushOutcome, PushRow, SyncBackend } from '@/sync/backend'

type Store = Map<string, Map<string, Record<string, unknown>>>

// The chained workout tables, mirroring the real schema's foreign keys.
const PARENTS: Record<string, { table: string; field: string }> = {
  workoutExercises: { table: 'workouts', field: 'workoutId' },
  sets: { table: 'workoutExercises', field: 'workoutExerciseId' },
}

export class MockBackend implements SyncBackend {
  private store: Store = new Map()

  /** Queue of forced outcomes; when empty, push succeeds. FIFO per call. */
  private forced: PushOutcome[] = []
  /** Every push seen, in order — for asserting drain order. */
  readonly pushed: PushRow[] = []

  /** Force the next N pushes to return this outcome, then resume succeeding. */
  forceNext(outcome: PushOutcome, times = 1): void {
    for (let i = 0; i < times; i += 1) this.forced.push(outcome)
  }

  /**
   * Fail every push to one table. Push order is by table dependency, not by when
   * a row was queued, so a test that wants a *particular* row to fail says which
   * table rather than counting pushes.
   */
  private failingTables = new Map<string, PushOutcome>()

  failTable(table: string, outcome: PushOutcome): void {
    this.failingTables.set(table, outcome)
  }

  async push(row: PushRow): Promise<PushOutcome> {
    this.pushed.push(row)
    const byTable = this.failingTables.get(row.table)
    if (byTable) return byTable
    const forced = this.forced.shift()
    if (forced && forced.status !== 'ok') return forced

    // Model the foreign key: a child whose parent isn't here yet is rejected the
    // way Postgres rejects it — transiently, because the parent may still be
    // queued behind it. Without this the mock accepts orphans and the engine's
    // ordering guarantees can't be tested at all.
    const parent = PARENTS[row.table]
    if (parent) {
      const parentId = row.row[parent.field]
      if (typeof parentId === 'string' && !this.store.get(parent.table)?.has(parentId)) {
        return {
          status: 'transient',
          error: `insert or update on table "${row.table}" violates foreign key constraint`,
        }
      }
    }

    // Model `one_active_workout` (0001_schema.sql): a partial unique index allowing
    // at most one workout per user with ended_at null and deleted_at null. Pushing
    // a stale "in progress" payload violates it permanently, which is what used to
    // dead-letter a whole finished session. Without this the mock accepts it.
    if (row.table === 'workouts') {
      const payload = row.row as { endedAt?: unknown; deletedAt?: unknown }
      if (payload.endedAt === null && payload.deletedAt === null) {
        for (const [id, existing] of this.store.get('workouts') ?? []) {
          if (id === row.rowId) continue
          const other = existing as { endedAt?: unknown; deletedAt?: unknown }
          if (other.endedAt === null && other.deletedAt === null) {
            return {
              status: 'permanent',
              error:
                'duplicate key value violates unique constraint "one_active_workout"',
            }
          }
        }
      }
    }

    const table = this.store.get(row.table) ?? new Map()
    // Upsert on rowId — idempotent, so a replay is harmless.
    const existing = table.get(row.rowId) ?? {}
    table.set(row.rowId, { ...existing, ...row.row, id: row.rowId })
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
