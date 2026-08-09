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
import { syncLog } from './log'

/**
 * Tables that participate in sync, in dependency order for the initial pull.
 *
 * `personalRecords` is deliberately absent: PRs are *derived* from sets, and the
 * repository recomputes them locally on every set change without enqueuing. Each
 * device rebuilds its own from the synced sets (the server does the same via
 * `rebuild_prs`), so syncing the derived rows would be both redundant and a
 * source of push/pull disagreement.
 */
export const SYNCED_TABLES = [
  'profiles',
  'muscles',
  'exercises',
  'templates',
  'templateExercises',
  'workouts',
  'workoutExercises',
  'sets',
  'metricDefinitions',
  'metricEntries',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

/**
 * Backoff for transient failures: exponential with a 5-minute cap, plus jitter.
 *
 * `jitter` is a 0–1 fraction the caller supplies (a random value in prod), used
 * to spread retries across ±25% so many clients don't retry in lockstep after a
 * shared outage. Defaulting it to 0.5 keeps the function pure and testable; the
 * drain passes a real random value.
 */
export function backoffMs(attempts: number, jitter = 0.5): number {
  const base = Math.min(5 * 60_000, 1000 * 2 ** attempts)
  const spread = base * 0.25 * (jitter * 2 - 1) // ±25%
  return Math.round(base + spread)
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
          syncLog.info(`pushed ${entry.op} ${entry.table}/${entry.rowId}`)
          continue
        }

        if (outcome.status === 'auth') {
          syncLog.warn(
            `auth failure on ${entry.op} ${entry.table}/${entry.rowId} — pausing drain for re-auth`,
            outcome.error,
          )
          return { pushed, deadLettered, stoppedBecause: 'auth' }
        }

        if (outcome.status === 'permanent') {
          // A permanent failure is the silent killer — the write is dropped to
          // the dead-letter queue and never retried. Log loudly with the reason
          // so "failed to sync" has an explanation (RLS 42501, missing column
          // 42703, constraint 23xxx, …).
          syncLog.warn(
            `DROPPED ${entry.op} ${entry.table}/${entry.rowId} (permanent) — dead-lettered`,
            outcome.error,
          )
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
        const nextAttemptAt = now + backoffMs(attempts, Math.random())
        await db.outbox.update(entry.seq!, {
          attempts,
          lastError: outcome.error,
          nextAttemptAt,
        })
        syncLog.warn(
          `transient failure on ${entry.op} ${entry.table}/${entry.rowId} ` +
            `(attempt ${attempts}) — retrying in ${Math.round((nextAttemptAt - now) / 1000)}s`,
          outcome.error,
        )
        return { pushed, deadLettered, stoppedBecause: 'transient' }
      }
    } finally {
      this.draining = false
    }

    if (pushed > 0 || deadLettered > 0) {
      syncLog.info(`drain done — pushed ${pushed}, dead-lettered ${deadLettered}`)
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

      let rows
      try {
        rows = await this.backend.pull(table, since)
      } catch (error) {
        // One table failing to pull (e.g. a missing column on an out-of-date
        // server) must not abort the pull for every other table — and it must
        // not become an unhandled rejection. Log it and move on; the cursor is
        // untouched, so the next pull retries this table from the same point.
        syncLog.warn(`pull failed for ${table} — skipping this cycle`, String(error))
        continue
      }
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

    if (applied > 0) syncLog.info(`pull applied ${applied} rows`)
    return { applied }
  }

  /** A full reconcile: drain local writes first, then pull server deltas. */
  async sync(
    now = Date.now(),
  ): Promise<{ drain: DrainResult; pull: { applied: number } }> {
    const drain = await this.drain(now)
    // Only pull if we're not paused on auth — a pull would also fail auth.
    const pull = drain.stoppedBecause === 'auth' ? { applied: 0 } : await this.pull()
    return { drain, pull }
  }

  /**
   * Physically erases the signed-in user's training data from the server.
   *
   * The soft-delete path (a `deleted_at` tombstone per row) is what sync
   * requires — but it leaves every row in Postgres, which is not what a user
   * asking to erase their data means. This is the deliberate hard delete.
   *
   * Order is load-bearing:
   *   1. **Clear the queues first.** A pending push for a row we're about to
   *      erase would recreate it after the delete — the classic resurrection
   *      bug. Dropping the outbox and dead-letter first makes that impossible.
   *   2. **Delete children before parents** (reverse dependency order). FK
   *      cascades would handle it, but not every table is reachable by a
   *      cascade, and explicit order keeps this correct if cascades change.
   *   3. **Reset the pull cursors.** They're high-water marks; leaving them set
   *      would make the next pull a no-op and mask a partial failure. Resetting
   *      to zero means the next pull re-reads from scratch and reflects reality.
   *
   * `profiles`, `muscles`, and `metricDefinitions` are deliberately excluded:
   * the profile is the account itself, and those two are shared-library tables
   * whose system rows must survive. Custom exercises are covered by `exercises`,
   * where RLS limits the delete to rows the user owns.
   *
   * Returns per-table failures rather than throwing, so a partial failure is
   * reported honestly instead of looking like success.
   */
  async hardDeleteServerData(): Promise<{ failed: { table: string; error: string }[] }> {
    // Children first. Anything not listed is intentionally preserved.
    const ERASE_ORDER = [
      'sets',
      'workoutExercises',
      'workouts',
      'templateExercises',
      'templates',
      'metricEntries',
      'exercises',
    ] as const

    // 1. No queued write may outlive the delete.
    await db.outbox.clear()
    await db.deadLetter.clear()

    const failed: { table: string; error: string }[] = []
    for (const table of ERASE_ORDER) {
      const result = await this.backend.hardDeleteAll(table)
      if (!result.ok) {
        failed.push({ table, error: result.error })
        syncLog.warn(`hard delete failed for ${table}`, result.error)
      } else {
        syncLog.info(`hard deleted all server rows in ${table}`)
      }
    }

    // 3. Cursors reset, so the next pull reflects the server's real state.
    await db.syncState.clear()

    return { failed }
  }

  /**
   * Requeue every dead-lettered write back onto the outbox for another attempt.
   *
   * Dead-lettered rows are dropped from the drain and never retried on their own
   * — correct when the failure is truly permanent (a poison payload), but wrong
   * when the cause was external and since fixed (an out-of-date server schema
   * that's now migrated, or a row that has since been re-owned by an account
   * upgrade). This is the user-driven "try again" after fixing the root cause.
   *
   * Two things make this more than a straight replay, both learned from real
   * RLS failures after a device-only → account upgrade:
   *
   *   1. **Re-read the row, don't replay the payload.** A dead-lettered entry
   *      froze the row as it was when it failed — for a workout that means
   *      `user_id: 'local-user'`, which RLS rejects forever. Reading the current
   *      row from Dexie picks up the claimed ownership instead.
   *   2. **Requeue in dependency order.** A chained row (`workout_exercises`,
   *      `sets`) only passes its RLS check once its parent exists server-side
   *      under the caller's uid. Replaying in dead-letter order can put a child
   *      ahead of its parent, which fails with exactly the RLS error it was
   *      dead-lettered for. SYNCED_TABLES is already in dependency order, so
   *      sorting by it makes the replay safe.
   *
   * A row that no longer exists locally is dropped rather than requeued — there
   * is nothing left to push, and replaying a stale snapshot of it would be wrong.
   * Returns how many were requeued.
   */
  async retryDeadLettered(): Promise<number> {
    const failed = await db.deadLetter.toArray()
    if (failed.length === 0) return 0

    // Dependency order, then original queue order within a table.
    const rank = (table: string) => {
      const index = (SYNCED_TABLES as readonly string[]).indexOf(table)
      return index === -1 ? SYNCED_TABLES.length : index
    }
    const ordered = [...failed].sort(
      (a, b) => rank(a.table) - rank(b.table) || (a.seq ?? 0) - (b.seq ?? 0),
    )

    let requeued = 0
    let dropped = 0

    for (const entry of ordered) {
      // Re-read the live row so the push carries current ownership and values.
      const current = await currentRow(entry.table, entry.rowId)
      if (current === undefined) {
        // The row is gone locally; there's nothing to push.
        await db.deadLetter.delete(entry.seq!)
        dropped += 1
        continue
      }

      await db.transaction('rw', db.outbox, db.deadLetter, async () => {
        await db.outbox.add({
          table: entry.table,
          // Always an upsert on a known id — safe whether the server has it yet.
          op: 'update',
          rowId: entry.rowId,
          payload: current,
          clientRev: Number((current as { clientRev?: unknown }).clientRev ?? 1),
          queuedAt: entry.queuedAt,
          attempts: 0,
        })
        await db.deadLetter.delete(entry.seq!)
      })
      requeued += 1
    }

    syncLog.info(
      `requeued ${requeued} dead-lettered writes for retry` +
        (dropped > 0 ? ` (dropped ${dropped} whose row no longer exists)` : ''),
    )
    return requeued
  }
}

/** The current row behind a dead-lettered entry, or undefined if it's gone. */
async function currentRow(
  table: string,
  rowId: string,
): Promise<Record<string, unknown> | undefined> {
  if (!(SYNCED_TABLES as readonly string[]).includes(table)) return undefined
  return tableStore(table as SyncedTable).get(rowId)
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
  if (table === 'profiles') {
    // A server profile from before a column existed arrives without it; backfill
    // defaults so the client never renders against undefined (e.g. the Home ring
    // showing "/NaN" when weeklyWorkoutGoal is missing).
    return {
      ...row,
      weeklyWorkoutGoal: row.weeklyWorkoutGoal ?? 4,
      showAvatar: row.showAvatar ?? false,
      heightCm: row.heightCm ?? null,
      trainingGoal: row.trainingGoal ?? '',
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
    get: (id: string) => Promise<Record<string, unknown> | undefined>
  }
}
