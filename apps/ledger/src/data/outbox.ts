// The durable write queue and the row-write helper every domain module builds on.
// One entry per dirty row; the drain reads the row itself at push time. Ledger has
// no deferral (REPutation holds an in-progress workout's writes) — every write is
// ready to push the moment it lands.

import { db } from '@/db'
import { touch } from '@tracker-engine/local-first'
import type { OutboxEntry } from '@tracker-engine/local-first'

export function newId(): string {
  // randomUUID needs a secure context; dev over http://<lan-ip> (phone-on-wifi) isn't
  // one, so fall back rather than throw on every write.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'id-' + crypto.getRandomValues(new Uint32Array(4)).join('-')
}

/**
 * Marks a row as needing to reach the server. Idempotent per row: a second edit
 * refreshes the existing entry (keeping its `seq`, so push order stays stable) and
 * resets the retry state. A tombstone is just the row's current state, so a delete
 * needs no special case.
 */
export async function enqueue(table: string, rowId: string): Promise<void> {
  const existing = await db.outbox.where('[table+rowId]').equals([table, rowId]).first()
  if (existing?.seq !== undefined) {
    await db.outbox.update(existing.seq, {
      attempts: 0,
      lastError: undefined,
      nextAttemptAt: undefined,
    })
    return
  }
  await db.outbox.add({ table, rowId, queuedAt: Date.now(), attempts: 0 } as OutboxEntry)
}

// A minimal view of a Dexie table for the write path — sidesteps Dexie's literal-key
// generics (e.g. profile's 'me') and per-row types, which don't unify with a generic.
interface WritableStore {
  get(id: string): Promise<{ clientRev: number } | undefined>
  update(id: string, changes: Record<string, unknown>): Promise<number>
}

// Synced client-authored tables only. `profile` is device-local (see repository).
const WRITE_STORES: Record<string, WritableStore> = {
  entries: db.entries as unknown as WritableStore,
  categories: db.categories as unknown as WritableStore,
  budgets: db.budgets as unknown as WritableStore,
  rules: db.rules as unknown as WritableStore,
  categoryOverrides: db.categoryOverrides as unknown as WritableStore,
}

/** Applies a patch to a row, stamps it, and queues it — the one client-write path. */
export async function patch(
  table: string,
  id: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const store = WRITE_STORES[table]
  if (!store) throw new Error(`No writable store for table "${table}"`)
  const current = await store.get(id)
  if (!current) return
  await store.update(id, { ...changes, ...touch(current.clientRev) })
  await enqueue(table, id)
}
