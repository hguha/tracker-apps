/**
 * Proves the SyncEngine is genuinely schema-driven — the refactor that lets a
 * second app (see docs/design-expense-tracker.md) reuse it. Here the engine runs
 * against a made-up, non-workout schema backed by in-memory stores, exercising the
 * two things a finance app needs: pull routing through schema.store + schema.normalize,
 * and drain skipping SERVER-authored tables (pulled bank data the client never pushes).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { SyncEngine } from '@/sync/engine'
import type { SyncRowStore, SyncSchema } from '@/sync/schema'
import type { PulledRow, PushOutcome, PushRow, SyncBackend } from '@/sync/backend'

function memStore(): SyncRowStore & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    rows,
    async put(row) {
      rows.set(String(row.id), row)
    },
    async get(id) {
      return rows.get(id)
    },
  }
}

class FakeBackend implements SyncBackend {
  readonly pushed: PushRow[] = []
  toPull: Record<string, PulledRow[]> = {}
  async push(row: PushRow): Promise<PushOutcome> {
    this.pushed.push(row)
    return { status: 'ok' }
  }
  async pull(table: string, since: number): Promise<PulledRow[]> {
    return (this.toPull[table] ?? []).filter((r) => Number(r.row.updatedAt ?? 0) > since)
  }
  async hardDeleteAll(): Promise<{ ok: true }> {
    return { ok: true }
  }
}

// A toy two-table schema with a server-authored table, standing in for a finance app.
function makeSchema() {
  const stores: Record<string, ReturnType<typeof memStore>> = {
    notes: memStore(),
    ledgerTxns: memStore(),
  }
  const schema: SyncSchema = {
    tables: ['notes', 'ledgerTxns'],
    parentIdOf: () => undefined,
    normalize: (table, row) =>
      table === 'notes' ? { ...row, tag: row.tag ?? 'default' } : row,
    store: (table) => {
      const store = stores[table]
      if (!store) throw new Error(`no store for ${table}`)
      return store
    },
    eraseOrder: ['ledgerTxns', 'notes'],
    serverAuthored: ['ledgerTxns'],
  }
  return { schema, stores }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('schema-driven engine', () => {
  it('pull routes rows through the schema store and normalize', async () => {
    const backend = new FakeBackend()
    const { schema, stores } = makeSchema()
    backend.toPull.notes = [{ table: 'notes', row: { id: 'n1', updatedAt: 5 } }]

    const engine = new SyncEngine(backend, schema)
    const { applied } = await engine.pull()

    expect(applied).toBe(1)
    // normalize() filled in the default tag; the row landed in the schema's store.
    expect(stores.notes!.rows.get('n1')).toMatchObject({ id: 'n1', tag: 'default' })
  })

  it('drain pushes client-authored rows but never server-authored ones', async () => {
    const backend = new FakeBackend()
    const { schema, stores } = makeSchema()
    stores.notes!.rows.set('n1', { id: 'n1' })
    stores.ledgerTxns!.rows.set('t1', { id: 't1' })
    await db.outbox.add({ table: 'notes', rowId: 'n1', queuedAt: Date.now(), attempts: 0 })
    await db.outbox.add({ table: 'ledgerTxns', rowId: 't1', queuedAt: Date.now(), attempts: 0 })

    const engine = new SyncEngine(backend, schema)
    await engine.drain()

    // Only the client-authored table was pushed.
    expect(backend.pushed.map((p) => p.table)).toEqual(['notes'])
    // The server-authored entry was left untouched in the queue, not sent or dropped.
    const remaining = await db.outbox.toArray()
    expect(remaining.some((e) => e.table === 'ledgerTxns')).toBe(true)
    expect(remaining.some((e) => e.table === 'notes')).toBe(false)
  })
})
