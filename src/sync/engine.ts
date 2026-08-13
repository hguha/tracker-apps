/**
 * The sync engine (§5.5). IndexedDB is authoritative; this reconciles it with the
 * server. Backend-agnostic (§5.6): talks only to `SyncBackend`.
 */

import { db, isReadyToPush, type OutboxEntry } from '@/db/database'
import type { PushRow, SyncBackend } from './backend'
import { syncLog } from './log'

/**
 * Tables that participate in sync, in dependency order for the initial pull.
 * `personalRecords` is deliberately absent: PRs are derived from sets and
 * recomputed locally per device, so syncing them would be redundant and cause
 * push/pull disagreement.
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
 * Exponential backoff with a 5-minute cap. `jitter` (0–1) spreads retries ±25% so
 * clients don't retry in lockstep after a shared outage; defaulting it keeps the
 * function pure for tests.
 */
export function backoffMs(attempts: number, jitter = 0.5): number {
  const base = Math.min(5 * 60_000, 1000 * 2 ** attempts)
  const spread = base * 0.25 * (jitter * 2 - 1) // ±25%
  return Math.round(base + spread)
}

export interface DrainResult {
  pushed: number
  deadLettered: number
  stoppedBecause: 'auth' | 'transient' | null
}

export class SyncEngine {
  private draining = false

  constructor(private backend: SyncBackend) {}

  /**
   * Drains the outbox one entry at a time, oldest first. Returns when the queue
   * empties or a transient/auth failure halts it. Re-entrant-safe.
   */
  async drain(now = Date.now()): Promise<DrainResult> {
    if (this.draining) return { pushed: 0, deadLettered: 0, stoppedBecause: null }
    this.draining = true
    let pushed = 0
    let deadLettered = 0

    try {
      // Ordered by seq so dependent writes replay in insertion order. Re-read each
      // iteration to pick up entries added mid-drain. Deferred entries are skipped
      // rather than blocking, so one live workout doesn't stall unrelated writes.
      while (true) {
        const entry = await db.outbox.orderBy('seq').filter(isReadyToPush).first()
        if (!entry) break

        // Stop the whole drain if the head entry is still backing off, so order holds.
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
          // Dead-letter and never retry; log loudly with the reason so a silent
          // "failed to sync" has an explanation (RLS 42501, missing column 42703, …).
          syncLog.warn(
            `DROPPED ${entry.op} ${entry.table}/${entry.rowId} (permanent) — dead-lettered`,
            outcome.error,
          )
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

        // Transient: schedule a backoff and stop so order is preserved — a later
        // row can depend on this one, so pushing past it would order child before
        // parent. `drainUntilSettled` handles retrying without user action.
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
   * Pulls deltas for every synced table into IndexedDB. Merge rule (§5.5): the
   * server row wins, unless a local outbox entry for that row is still pending —
   * then local optimistic state holds until its push lands.
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
        // One table failing must not abort the others; cursor is untouched so the
        // next pull retries this table from the same point.
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

        if (pendingRowIds.has(`${table}:${id}`)) continue

        // Tombstones are applied as ordinary rows (deletedAt set); keeping the row
        // rather than hard-deleting stops a later pull resurrecting it.
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
    // Skip the pull when paused on auth — it would fail auth too.
    const pull = drain.stoppedBecause === 'auth' ? { applied: 0 } : await this.pull()
    return { drain, pull }
  }

  /**
   * Drains repeatedly until the queue settles, waiting out each backoff, so one
   * flaky row doesn't need repeated manual retries. Stops early on `auth` and
   * gives up after `maxRounds` so an unreachable server can't spin forever.
   */
  async drainUntilSettled(
    opts: {
      maxRounds?: number
      onProgress?: (progress: { pushed: number; remaining: number }) => void
      sleep?: (ms: number) => Promise<void>
    } = {},
  ): Promise<{ pushed: number; deadLettered: number; remaining: number }> {
    const maxRounds = opts.maxRounds ?? 12
    const sleep =
      opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

    let pushed = 0
    let deadLettered = 0
    // The clock the drain sees, advanced past each backoff we wait out. Carrying it
    // explicitly lets a test stub `sleep` and stay instant.
    let clock = Date.now()

    for (let round = 0; round < maxRounds; round += 1) {
      const result = await this.drain(clock)
      pushed += result.pushed
      deadLettered += result.deadLettered

      const ready = (await db.outbox.toArray()).filter(isReadyToPush)
      opts.onProgress?.({ pushed, remaining: ready.length })

      if (ready.length === 0) break
      // Nothing will succeed until the user re-authenticates.
      if (result.stoppedBecause === 'auth') break

      // Wait out the *head* entry's backoff specifically. It's the one blocking
      // the drain, and it's the only one whose schedule matters — taking a min
      // across every ready entry picks up the ones that have never failed (no
      // `nextAttemptAt`, so 0), which reads as "due now" and exits immediately.
      const head = ready.reduce((a, b) => ((a.seq ?? 0) <= (b.seq ?? 0) ? a : b))
      const dueAt = head.nextAttemptAt ?? 0
      const waitMs = Math.max(0, dueAt - clock)

      // Nothing moved, and the head entry is already due — it's failing outright
      // rather than backing off, so stop instead of spinning.
      if (result.pushed === 0 && result.deadLettered === 0 && waitMs === 0) break

      if (waitMs > 0) {
        await sleep(Math.min(waitMs, 30_000))
        clock = Math.max(Date.now(), dueAt)
      } else {
        clock = Date.now()
      }
    }

    const remaining = (await db.outbox.toArray()).filter(isReadyToPush).length
    syncLog.info(
      `drainUntilSettled — pushed ${pushed}, dead-lettered ${deadLettered}, remaining ${remaining}`,
    )
    return { pushed, deadLettered, remaining }
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
    const ERASE_ORDER = [
      'sets',
      'workoutExercises',
      'workouts',
      'templateExercises',
      'templates',
      'metricEntries',
      'exercises',
    ] as const

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

    await db.syncState.clear()

    return { failed }
  }

  /**
   * Discards every un-pushed local change and re-pulls the server's version.
   *
   * The deliberate counterpart to `drain()`: where that insists local wins, this
   * concedes. For when a device has diverged — a stale edit, a botched offline
   * session, writes that keep failing — and the server's copy is the one you
   * trust.
   *
   * Drops the outbox and the dead-letter queue, resets the pull cursors so the
   * next pull re-reads everything rather than only deltas, then pulls. Local rows
   * the server also has are overwritten; local rows it has never seen remain
   * (nothing can restore them, and deleting them would lose data the user never
   * asked to lose).
   *
   * Returns what it discarded and re-applied, so the UI can be specific.
   */
  async discardLocalChanges(): Promise<{ discarded: number; applied: number }> {
    const discarded = (await db.outbox.count()) + (await db.deadLetter.count())
    await db.outbox.clear()
    await db.deadLetter.clear()
    await db.syncState.clear()
    const { applied } = await this.pull()
    syncLog.info(
      `discarded ${discarded} local changes, re-applied ${applied} server rows`,
    )
    return { discarded, applied }
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
      const current = await currentRow(entry.table, entry.rowId)
      if (current === undefined) {
        await db.deadLetter.delete(entry.seq!)
        dropped += 1
        continue
      }

      await db.transaction('rw', db.outbox, db.deadLetter, async () => {
        await db.outbox.add({
          table: entry.table,
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
 * `aliases` may be absent on an exercise pulled from Postgres, and code that
 * iterates it throws `not iterable` and blanks the screen. `movementPattern` is
 * derived locally from the primary muscle rather than stored, so a pulled row can
 * carry a value from the retired eleven-value taxonomy; leaving it would quietly
 * break cardio detection and the "Push"/"Pull" session titles. The launch-time
 * repair in `db/seed` fixes rows already written.
 */
function normalizeRow(
  table: SyncedTable,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (table === 'exercises') {
    const { secondaryMuscles: _dropped, ...rest } = row
    return { ...rest, aliases: row.aliases ?? [] }
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
      onboardedAt: row.onboardedAt ?? null,
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
    metricDefinitions: db.metricDefinitions,
    metricEntries: db.metricEntries,
  } as const
  return map[table] as unknown as {
    put: (row: Record<string, unknown>) => Promise<unknown>
    get: (id: string) => Promise<Record<string, unknown> | undefined>
  }
}
