// The sync engine. IndexedDB is authoritative; this reconciles it with the server.
// Backend-agnostic (talks only to `SyncBackend`), domain-agnostic (driven by a
// `SyncSchema`), and app-agnostic (persistence + app services arrive as `SyncDeps`),
// so a second app reuses it by supplying its own schema and deps.

import type { SyncBackend } from './backend'
import type { SyncSchema } from './schema'
import type { OutboxEntry, SyncDeps } from './types'
import { isReadyToPush } from './types'
import { syncLog } from './log'

// Exponential backoff, 5-minute cap. `jitter` (0–1) spreads retries ±25% so clients don't retry in lockstep after a shared outage.
export function backoffMs(attempts: number, jitter = 0.5): number {
  const base = Math.min(5 * 60_000, 1000 * 2 ** attempts)
  const spread = base * 0.25 * (jitter * 2 - 1) // ±25%
  return Math.round(base + spread)
}

/**
 * How many times a row may fail transiently before it is dead-lettered.
 *
 * There has to be a ceiling. A row can be *permanently* broken in a way the
 * server reports as retryable — a foreign key to a parent that will never exist,
 * say — and without a cap that row retries every five minutes for the life of the
 * install, which is the "sync runs forever" failure. Reaching the cap turns an
 * invisible infinite retry into one visible, reportable failure the user can act
 * on. Eight attempts spans roughly 20 minutes of backoff, so a genuine outage
 * still clears on its own.
 */
const MAX_ATTEMPTS = 8

export interface DrainResult {
  pushed: number
  deadLettered: number
  stoppedBecause: 'auth' | 'transient' | null
}

export class SyncEngine {
  private draining = false

  constructor(
    private backend: SyncBackend,
    private schema: SyncSchema,
    private deps: SyncDeps,
  ) {}

  // Push order: parents before children, so a foreign key can't be violated by
  // ordering. schema.tables is already in dependency order.
  private tableRank(table: string): number {
    const index = this.schema.tables.indexOf(table)
    return index === -1 ? this.schema.tables.length : index
  }

  private async currentRow(
    table: string,
    rowId: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.schema.tables.includes(table)) return undefined
    return this.schema.store(table).get(rowId)
  }

  /**
   * Pushes every ready row, parents before children.
   *
   * Ordering is by table dependency (schema.tables) and then by `seq`, so a child
   * can never reach the server ahead of its parent — the foreign key holds by
   * construction rather than by failing and retrying. A row that fails only
   * blocks its own descendants; everything independent still goes, so one bad
   * write can't stall the queue behind it. Re-entrant-safe.
   */
  async drain(now = Date.now()): Promise<DrainResult> {
    if (this.draining) return { pushed: 0, deadLettered: 0, stoppedBecause: null }
    this.draining = true

    let pushed = 0
    let deadLettered = 0
    let stoppedBecause: DrainResult['stoppedBecause'] = null
    // Rows the server refused outright. A descendant can never land while its
    // parent is missing, so it's dead-lettered alongside it, naming the row to
    // fix — otherwise the real cause is buried under a pile of child failures.
    const rejected = new Set<string>()
    // Rows that failed for a reason that may pass later. A descendant is left
    // queued, not sent: the request would only fail on the foreign key and burn
    // an attempt on someone else's problem.
    const blocked = new Set<string>()

    try {
      const serverAuthored = new Set(this.schema.serverAuthored ?? [])
      const ready = (await this.deps.outbox.toArray())
        .filter(isReadyToPush)
        // Server-authored tables (e.g. bank data pulled via aggregation) are never
        // pushed — the client doesn't own them. Empty for REPutation.
        .filter((entry) => !serverAuthored.has(entry.table))
        .sort((a, b) => this.tableRank(a.table) - this.tableRank(b.table) || a.seq! - b.seq!)

      for (const entry of ready) {
        if (entry.nextAttemptAt !== undefined && entry.nextAttemptAt > now) {
          stoppedBecause = 'transient'
          continue
        }

        const row = await this.currentRow(entry.table, entry.rowId)
        // Gone locally — a placeholder that was never filled in, or a discarded
        // row. There is nothing to send, so stop tracking it.
        if (row === undefined) {
          await this.deps.outbox.delete(entry.seq!)
          syncLog.info(`dropped ${entry.table}/${entry.rowId} — no local row`)
          continue
        }

        const parentId = this.schema.parentIdOf(entry.table, row)
        if (parentId !== undefined && rejected.has(parentId)) {
          rejected.add(entry.rowId)
          await this.deadLetter(
            entry,
            row,
            `Not sent: its parent row ${parentId} was rejected by the server.`,
            entry.attempts,
            now,
          )
          deadLettered += 1
          continue
        }
        if (parentId !== undefined && blocked.has(parentId)) {
          blocked.add(entry.rowId)
          stoppedBecause = 'transient'
          syncLog.info(
            `held ${entry.table}/${entry.rowId} — parent ${parentId} hasn't landed`,
          )
          continue
        }

        const outcome = await this.backend.push({
          table: entry.table,
          rowId: entry.rowId,
          row,
        })

        if (outcome.status === 'ok') {
          await this.deps.outbox.delete(entry.seq!)
          pushed += 1
          syncLog.info(`pushed ${entry.table}/${entry.rowId}`)
          continue
        }

        // Every push carries the same token, so one auth failure means they all
        // fail. Stop the pass and leave the queue intact for after re-auth.
        if (outcome.status === 'auth') {
          syncLog.warn(
            `auth failure on ${entry.table}/${entry.rowId} — pausing for re-auth`,
            outcome.error,
          )
          return { pushed, deadLettered, stoppedBecause: 'auth' }
        }

        const attempts = entry.attempts + 1
        // Out of attempts counts as refused: retrying has stopped being a plan.
        if (outcome.status === 'permanent' || attempts >= MAX_ATTEMPTS) {
          const reason =
            outcome.status === 'permanent'
              ? outcome.error
              : `still failing after ${attempts} attempts: ${outcome.error}`
          rejected.add(entry.rowId)
          await this.deadLetter(entry, row, reason, attempts, now)
          deadLettered += 1
          continue
        }

        // Worth another go later: back it off and let the rest of the pass run.
        const nextAttemptAt = now + backoffMs(attempts, Math.random())
        await this.deps.outbox.update(entry.seq!, {
          attempts,
          lastError: outcome.error,
          nextAttemptAt,
        })
        blocked.add(entry.rowId)
        stoppedBecause = 'transient'
        syncLog.warn(
          `transient failure on ${entry.table}/${entry.rowId} (attempt ${attempts}` +
            `/${MAX_ATTEMPTS}) — retrying in ${Math.round((nextAttemptAt - now) / 1000)}s`,
          outcome.error,
        )
      }
    } finally {
      this.draining = false
    }

    if (pushed > 0 || deadLettered > 0) {
      syncLog.info(`drain done — pushed ${pushed}, dead-lettered ${deadLettered}`)
    }
    return { pushed, deadLettered, stoppedBecause }
  }

  private async deadLetter(
    entry: OutboxEntry,
    row: Record<string, unknown>,
    error: string,
    attempts: number,
    failedAt: number,
  ): Promise<void> {
    syncLog.warn(`DEAD-LETTERED ${entry.table}/${entry.rowId}`, error)
    await this.deps.moveToDeadLetter(entry.seq!, {
      table: entry.table,
      rowId: entry.rowId,
      row,
      queuedAt: entry.queuedAt,
      failedAt,
      attempts,
      error,
    })
    // Every dead-letter is reported: this is the only failure the user can't
    // resolve by waiting, so it needs to be diagnosable from the server side.
    // Age matters — a row queued days ago is a different story from a fresh one.
    const ageMinutes = Math.round((failedAt - entry.queuedAt) / 60_000)
    void this.deps.reportError(
      'sync-dead-letter',
      new Error(
        `${entry.table}/${entry.rowId} after ${attempts} attempt(s), ` +
          `queued ${ageMinutes}m ago: ${error}`,
      ),
    )
  }

  // Pulls deltas into IndexedDB. Merge rule: the server row wins unless a local outbox entry for that row is still pending.
  async pull(): Promise<{ applied: number }> {
    let applied = 0
    const pendingRowIds = new Set(
      (await this.deps.outbox.toArray()).map((e) => `${e.table}:${e.rowId}`),
    )

    for (const table of this.schema.tables) {
      const state = await this.deps.syncState.get(table)
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

      const store = this.schema.store(table)
      let highWater = since

      for (const { row } of rows) {
        const id = String((row as { id?: unknown }).id ?? '')
        const updatedAt = Number((row as { updatedAt?: unknown }).updatedAt ?? 0)
        if (updatedAt > highWater) highWater = updatedAt

        if (pendingRowIds.has(`${table}:${id}`)) continue

        // Tombstones are applied as ordinary rows (deletedAt set); keeping the row stops a later pull resurrecting it.
        await store.put(this.schema.normalize?.(table, row) ?? row)
        applied += 1
      }

      await this.deps.syncState.put({ table, lastPulledAt: highWater })
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

  /**
   * Drains repeatedly until the queue empties or nothing more can be done,
   * waiting out backoffs in between.
   *
   * Termination is guaranteed three ways: each round either makes progress or
   * ends the loop, every wait advances the clock past the soonest due time, and
   * `maxRounds` caps the whole thing regardless. Without all three this is the
   * natural place for a spin.
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
    // The clock the drain sees, advanced past each backoff waited out, so a test
    // can stub `sleep` without real time passing.
    let clock = Date.now()

    for (let round = 0; round < maxRounds; round += 1) {
      const result = await this.drain(clock)
      pushed += result.pushed
      deadLettered += result.deadLettered

      const ready = (await this.deps.outbox.toArray()).filter(isReadyToPush)
      opts.onProgress?.({ pushed, remaining: ready.length })

      if (ready.length === 0 || result.stoppedBecause === 'auth') break

      // The soonest any remaining row is due. Anything already due was tried this
      // round and failed, so waiting for the earliest future one is the only way
      // forward; if nothing is scheduled, another round would repeat this one.
      const dueTimes = ready
        .map((e) => e.nextAttemptAt ?? 0)
        .filter((at) => at > clock)
      if (dueTimes.length === 0) break

      const dueAt = Math.min(...dueTimes)
      await sleep(Math.min(dueAt - clock, 30_000))
      clock = Math.max(Date.now(), dueAt)
    }

    const remaining = (await this.deps.outbox.toArray()).filter(isReadyToPush).length
    syncLog.info(
      `drainUntilSettled — pushed ${pushed}, dead-lettered ${deadLettered}, remaining ${remaining}`,
    )
    return { pushed, deadLettered, remaining }
  }

  // Physically erases the signed-in user's data from the server (the deliberate hard
  // delete, vs. the tombstone path sync needs). Order is load-bearing: clear the queues
  // first or a pending push resurrects a deleted row; delete children before parents
  // (schema.eraseOrder); reset the pull cursors last so the next pull re-reads from
  // scratch. Returns per-table failures rather than throwing.
  async hardDeleteServerData(): Promise<{ failed: { table: string; error: string }[] }> {
    await this.deps.outbox.clear()
    await this.deps.deadLetter.clear()

    const failed: { table: string; error: string }[] = []
    for (const table of this.schema.eraseOrder) {
      const result = await this.backend.hardDeleteAll(table)
      if (!result.ok) {
        failed.push({ table, error: result.error })
        syncLog.warn(`hard delete failed for ${table}`, result.error)
      } else {
        syncLog.info(`hard deleted all server rows in ${table}`)
      }
    }

    await this.deps.syncState.clear()

    return { failed }
  }

  // Discards every un-pushed local change and re-pulls the server's version — the counterpart
  // to drain() for a diverged device. Resets the pull cursors so the next pull re-reads
  // everything; local rows the server has never seen remain, since nothing could restore them.
  async discardLocalChanges(): Promise<{ discarded: number; applied: number }> {
    const discarded = (await this.deps.outbox.count()) + (await this.deps.deadLetter.count())
    await this.deps.outbox.clear()
    await this.deps.deadLetter.clear()
    await this.deps.syncState.clear()
    const { applied } = await this.pull()
    syncLog.info(
      `discarded ${discarded} local changes, re-applied ${applied} server rows`,
    )
    return { discarded, applied }
  }

  /**
   * User-driven "try again": moves dead-lettered rows back onto the outbox.
   *
   * `enqueue` is what re-queues them, so they pick up the same deferral rule as
   * any other write (a row whose parent op is still open stays held) and the same
   * one-entry-per-row collapse. A row that no longer exists locally is dropped
   * rather than requeued — there's nothing left to send.
   */
  async retryDeadLettered(): Promise<number> {
    const failed = await this.deps.deadLetter.toArray()
    if (failed.length === 0) return 0

    let requeued = 0
    let dropped = 0

    for (const entry of failed) {
      if ((await this.currentRow(entry.table, entry.rowId)) === undefined) {
        await this.deps.deadLetter.delete(entry.seq!)
        dropped += 1
        continue
      }
      await this.deps.enqueue(entry.table, entry.rowId)
      await this.deps.deadLetter.delete(entry.seq!)
      requeued += 1
    }

    syncLog.info(
      `requeued ${requeued} dead-lettered writes for retry` +
        (dropped > 0 ? ` (dropped ${dropped} whose row no longer exists)` : ''),
    )
    return requeued
  }
}
