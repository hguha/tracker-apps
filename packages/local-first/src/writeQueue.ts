import { touch } from './stamp'
import type { OutboxEntry } from './types'

export function newId(): string {
  // randomUUID needs a secure context; dev over http://<lan-ip> (phone-on-wifi testing)
  // isn't one, so fall back rather than throw on every write.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'id-' + crypto.getRandomValues(new Uint32Array(4)).join('-')
}

export interface WritableRowStore {
  get(id: string): Promise<{ clientRev: number } | undefined>
  update(id: string, changes: Record<string, unknown>): Promise<unknown>
}

export interface WriteQueuePort {
  findByRow(table: string, rowId: string): Promise<OutboxEntry | undefined>
  add(entry: Omit<OutboxEntry, 'seq'>): Promise<unknown>
  update(seq: number, changes: Partial<OutboxEntry>): Promise<unknown>
  delete(seq: number): Promise<void>
}

export interface WriteQueueConfig {
  queue: WriteQueuePort
  /** The writable store for a client-authored table, or undefined if there isn't one. */
  store(table: string): WritableRowStore | undefined
  /**
   * The in-flight operation whose writes this row belongs to, if any. Held entries are
   * skipped by the drain, so a half-finished parent never reaches the server. Omit in
   * apps where every write is ready the moment it lands.
   */
  deferralFor?(table: string, rowId: string): Promise<string | undefined>
}

export interface WriteQueue {
  enqueue(table: string, rowId: string): Promise<void>
  forget(table: string, rowId: string): Promise<void>
  patch(table: string, id: string, changes: Record<string, unknown>): Promise<void>
}

export function createWriteQueue(config: WriteQueueConfig): WriteQueue {
  /**
   * Idempotent per row: a second edit refreshes the existing entry, keeping its `seq` so
   * push order (parents before children) stays stable, and resetting the retry state
   * because a fresh edit deserves a fresh attempt. A tombstone is just the row's current
   * state, so a delete needs no special case.
   */
  async function enqueue(table: string, rowId: string): Promise<void> {
    const deferredForWorkoutId = await config.deferralFor?.(table, rowId)
    const existing = await config.queue.findByRow(table, rowId)

    if (existing?.seq !== undefined) {
      await config.queue.update(existing.seq, {
        deferredForWorkoutId,
        attempts: 0,
        lastError: undefined,
        nextAttemptAt: undefined,
      })
      return
    }

    await config.queue.add({
      table,
      rowId,
      queuedAt: Date.now(),
      attempts: 0,
      deferredForWorkoutId,
    })
  }

  return {
    enqueue,

    async forget(table, rowId) {
      const entry = await config.queue.findByRow(table, rowId)
      if (entry?.seq !== undefined) await config.queue.delete(entry.seq)
    },

    async patch(table, id, changes) {
      const store = config.store(table)
      if (!store) throw new Error(`No writable store for table "${table}"`)
      const current = await store.get(id)
      if (!current) return
      await store.update(id, { ...changes, ...touch(current.clientRev) })
      await enqueue(table, id)
    },
  }
}
