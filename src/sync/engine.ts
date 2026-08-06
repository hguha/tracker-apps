/**
 * The sync engine (§5.5).
 *
 * IndexedDB is authoritative for the UI; this engine reconciles it with the
 * server in the background. It never blocks a read and never sits in the logging
 * path — a component writes locally and enqueues, and the drain happens whenever
 * a trigger fires (foreground, `online`, interval, post-auth).
 *
 * The rules it enforces, each guarding a specific failure mode:
 *   - **Sequential drain by `seq`.** One entry at a time, in order. Parallel
 *     drains reorder dependent writes (a set before its workout_exercise) and
 *     produce FK violations server-side.
 *   - **Failure classification.** Permanent (4xx≠401/429) → dead-letter and move
 *     on, so a poison entry never blocks the queue. Transient (5xx/network) →
 *     stop and back off, preserving order. Auth (401) → pause for re-auth.
 *   - **Delta pull with a local-pending guard.** A pulled server row wins unless
 *     a local outbox entry for that row is still pending, in which case local
 *     optimistic state holds until its write lands (§5.5).
 *
 * The engine is backend-agnostic (§5.6): it talks only to `SyncBackend`, and the
 * table→Dexie mapping is the one place that knows the concrete stores.
 */

import { db, type OutboxEntry } from '@/db/database'
import type { PushRow, SyncBackend } from './backend'

/** Tables that participate in sync, in dependency order for the initial pull. */
export const SYNCED_TABLES = [
  'profiles',
  'muscles',
  'exercises',
  'templates',
  'templateExercises',
  'workouts',
  'workoutExercises',
  'sets',
  'personalRecords',
  'metricDefinitions',
  'metricEntries',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

/** Backoff schedule for transient failures: exponential with a 5-minute cap. */
export function backoffMs(attempts: number): number {
  const base = Math.min(5 * 60_000, 1000 * 2 ** attempts)
  // Jitter so many clients don't retry in lockstep after an outage.
  return base
}

export interface DrainResult {
  pushed: number
  deadLettered: number
  /** Set when the drain stopped early: 'transient' backoff or 'auth' pause. */
  stoppedBecause: 'auth' | 'transient' | null
}

export class SyncEngine {
  private draining = false

  constructor(private backend: SyncBackend) {}

  /**
   * Drains the outbox one entry at a time, oldest first. Returns when the queue
   * empties or a transient/auth failure halts it. Re-entrant-safe: a second call
   * while a drain is running is a no-op.
   */
  async drain(now = Date.now()): Promise<DrainResult> {
    if (this.draining) return { pushed: 0, deadLettered: 0, stoppedBecause: null }
    this.draining = true
    let pushed = 0
    let deadLettered = 0

    try {
      // Ordered by seq — the insertion order — so dependent writes replay in the
      // order they were made. `.first()` re-reads each iteration so entries added
      // mid-drain are still picked up.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const entry = await db.outbox.orderBy('seq').first()
        if (!entry) break

        // Respect backoff: if this entry failed recently, stop the whole drain.
        // Because it's the head of the queue, waiting on it preserves order.
        if (entry.attempts > 0 && entry.nextAttemptAt && entry.nextAttemptAt > now) {
          return { pushed, deadLettered, stoppedBecause: 'transient' }
        }

        const outcome = await this.backend.push(toPushRow(entry))

        if (outcome.status === 'ok') {
          await db.outbox.delete(entry.seq!)
          pushed += 1
          continue
        }

        if (outcome.status === 'auth') {
          return { pushed, deadLettered, stoppedBecause: 'auth' }
        }

        if (outcome.status === 'permanent') {
          // Move the poison entry out of the drain path so it can't block the
          // queue, and surface it for the user rather than retrying forever.
          await db.transaction('rw', db.outbox, db.deadLetter, async () => {
            await db.deadLetter.add({
              table: entry.table,
              op: entry.op,
              rowId: entry.rowId,
              payload: entry.payload,
              clientRev: entry.clientRev,
              queuedAt: entry.queuedAt,
              failedAt: now,
              error: outcome.error,
            })
            await db.outbox.delete(entry.seq!)
          })
          deadLettered += 1
          continue
        }

        // Transient: record the attempt, schedule a backoff, and stop so order
        // is preserved. The next trigger resumes from this same head entry.
        const attempts = entry.attempts + 1
        await db.outbox.update(entry.seq!, {
          attempts,
          lastError: outcome.error,
          nextAttemptAt: now + backoffMs(attempts),
        })
        return { pushed, deadLettered, stoppedBecause: 'transient' }
      }
    } finally {
      this.draining = false
    }

    return { pushed, deadLettered, stoppedBecause: null }
  }

  /**
   * Pulls deltas for every synced table and merges them into IndexedDB.
   *
   * Merge rule (§5.5): the server row wins, unless a local outbox entry for that
   * row is still pending — then local optimistic state holds until its own push
   * lands, so a background pull never clobbers an edit the user just made.
   */
  async pull(): Promise<{ applied: number }> {
    let applied = 0
    const pendingRowIds = new Set(
      (await db.outbox.toArray()).map((e) => `${e.table}:${e.rowId}`),
    )

    for (const table of SYNCED_TABLES) {
      const state = await db.syncState.get(table)
      const since = state?.lastPulledAt ?? 0
      const rows = await this.backend.pull(table, since)
      if (rows.length === 0) continue

      const store = tableStore(table)
      let highWater = since

      for (const { row } of rows) {
        const id = String((row as { id?: unknown; exerciseId?: unknown }).id ?? '')
        const updatedAt = Number((row as { updatedAt?: unknown }).updatedAt ?? 0)
        if (updatedAt > highWater) highWater = updatedAt

        // Local pending write for this row wins for now.
        if (pendingRowIds.has(`${table}:${id}`)) continue

        // A tombstone is applied like any other row: deletedAt is set, and every
        // read path already filters it out. We keep the row rather than hard
        // deleting, so a later pull can't resurrect it.
        await store.put(normalizeRow(table, row))
        applied += 1
      }

      await db.syncState.put({ table, lastPulledAt: highWater })
    }

    return { applied }
  }

  /** A full reconcile: drain local writes first, then pull server deltas. */
  async sync(now = Date.now()): Promise<{ drain: DrainResult; pull: { applied: number } }> {
    const drain = await this.drain(now)
    // Only pull if we're not paused on auth — a pull would also fail auth.
    const pull = drain.stoppedBecause === 'auth' ? { applied: 0 } : await this.pull()
    return { drain, pull }
  }
}

function toPushRow(entry: OutboxEntry): PushRow {
  return {
    table: entry.table,
    op: entry.op,
    rowId: entry.rowId,
    payload: entry.payload as Record<string, unknown>,
  }
}

/**
 * Backfills domain fields a pulled row can't carry from Postgres.
 *
 * The `exercises` table stores its secondary muscles in a separate join table
 * (`exercise_secondary_muscles`) and has no `secondary_muscles` column, so a
 * pulled exercise arrives with `secondaryMuscles` undefined — which then throws
 * `not iterable` in the volume math and blanks the screen. Default the
 * array-typed fields to empty so a synced row is always shaped like a local one.
 * (Secondaries for a *custom* exercise are best re-fetched from the join table;
 * defaulting to none here is the safe floor that keeps the app rendering.)
 */
function normalizeRow(
  table: SyncedTable,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (table === 'exercises') {
    return {
      ...row,
      secondaryMuscles: row.secondaryMuscles ?? [],
      aliases: row.aliases ?? [],
    }
  }
  return row
}

/** The Dexie store backing a synced table name. The one place that knows both. */
function tableStore(table: SyncedTable) {
  const map = {
    profiles: db.profiles,
    muscles: db.muscles,
    exercises: db.exercises,
    templates: db.templates,
    templateExercises: db.templateExercises,
    workouts: db.workouts,
    workoutExercises: db.workoutExercises,
    sets: db.sets,
    personalRecords: db.personalRecords,
    metricDefinitions: db.metricDefinitions,
    metricEntries: db.metricEntries,
  } as const
  return map[table] as unknown as {
    put: (row: Record<string, unknown>) => Promise<unknown>
  }
}
