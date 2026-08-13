// The sync engine (§5.5). IndexedDB is authoritative; this reconciles it with the
// server. Backend-agnostic (§5.6): talks only to `SyncBackend`.

import { db, isReadyToPush, type OutboxEntry } from '@/db/database'
import type { PushRow, SyncBackend } from './backend'
import { syncLog } from './log'

// Tables that participate in sync, in dependency order for the initial pull.
// `personalRecords` is absent: PRs are derived from sets and recomputed per device.
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

// Exponential backoff, 5-minute cap. `jitter` (0–1) spreads retries ±25% so clients don't retry in lockstep after a shared outage.
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

  // Drains the outbox oldest first; returns when it empties or a transient/auth failure halts it. Re-entrant-safe.
  async drain(now = Date.now()): Promise<DrainResult> {
    if (this.draining) return { pushed: 0, deadLettered: 0, stoppedBecause: null }
    this.draining = true
    let pushed = 0
    let deadLettered = 0

    try {
      // Ordered by seq so dependent writes replay in insertion order; re-read each iteration
      // to pick up mid-drain entries. Deferred entries are skipped so a live workout doesn't stall others.
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

        // Transient: schedule a backoff and stop so order holds — pushing past this could order a child before its parent.
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

  // Pulls deltas into IndexedDB. Merge rule (§5.5): the server row wins unless a local outbox entry for that row is still pending.
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
        // One table failing must not abort the others; the cursor is untouched so the next pull retries it.
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

        // Tombstones are applied as ordinary rows (deletedAt set); keeping the row stops a later pull resurrecting it.
        await store.put(normalizeRow(table, row))
        applied += 1
      }

      await db.syncState.put({ table, lastPulledAt: highWater })
    }

    if (applied > 0) syncLog.info(`pull applied ${applied} rows`)
    return { applied }
  }

  // A full reconcile: drain local writes first, then pull server deltas.
  async sync(
    now = Date.now(),
  ): Promise<{ drain: DrainResult; pull: { applied: number } }> {
    const drain = await this.drain(now)
    // Skip the pull when paused on auth — it would fail auth too.
    const pull = drain.stoppedBecause === 'auth' ? { applied: 0 } : await this.pull()
    return { drain, pull }
  }

  // Drains repeatedly until the queue settles, waiting out each backoff. Stops early on `auth` and gives up after `maxRounds`.
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
    // The clock the drain sees, advanced past each backoff waited out; carrying it explicitly lets a test stub `sleep`.
    let clock = Date.now()

    for (let round = 0; round < maxRounds; round += 1) {
      const result = await this.drain(clock)
      pushed += result.pushed
      deadLettered += result.deadLettered

      const ready = (await db.outbox.toArray()).filter(isReadyToPush)
      opts.onProgress?.({ pushed, remaining: ready.length })

      if (ready.length === 0) break
      if (result.stoppedBecause === 'auth') break

      // Wait out the head entry's backoff specifically — it's the one blocking the drain; a min across all ready entries would pick up never-failed ones (nextAttemptAt 0) and exit immediately.
      const head = ready.reduce((a, b) => ((a.seq ?? 0) <= (b.seq ?? 0) ? a : b))
      const dueAt = head.nextAttemptAt ?? 0
      const waitMs = Math.max(0, dueAt - clock)

      // Nothing moved and the head is already due — it's failing outright, not backing off, so stop instead of spinning.
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

  // Physically erases the signed-in user's training data from the server (the deliberate
  // hard delete, vs. the tombstone path sync needs). Order is load-bearing: clear the queues
  // first or a pending push resurrects a deleted row; delete children before parents; reset
  // the pull cursors last so the next pull re-reads from scratch. profiles/muscles/
  // metricDefinitions are excluded (account + shared-library system rows). Returns per-table
  // failures rather than throwing.
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

  // Discards every un-pushed local change and re-pulls the server's version — the counterpart
  // to drain() for a diverged device. Resets the pull cursors so the next pull re-reads
  // everything; local rows the server has never seen remain, since nothing could restore them.
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

  // User-driven "try again": requeue dead-lettered writes onto the outbox. Two invariants,
  // both from RLS failures after a device-only → account upgrade: (1) re-read the current row
  // rather than replay the frozen payload, whose `user_id: 'local-user'` RLS rejects forever;
  // (2) requeue in SYNCED_TABLES (dependency) order, or a chained row can go ahead of its
  // parent and fail RLS again. A row that no longer exists locally is dropped, not requeued.
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

// Backfills domain fields a pulled row can't carry from Postgres — e.g. a missing `aliases`
// that would throw `not iterable` and blank the screen.
function normalizeRow(
  table: SyncedTable,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (table === 'exercises') {
    const { secondaryMuscles: _dropped, ...rest } = row
    return { ...rest, aliases: row.aliases ?? [] }
  }
  if (table === 'profiles') {
    // A profile from before a column existed arrives without it; backfill defaults so the client never renders against undefined.
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
