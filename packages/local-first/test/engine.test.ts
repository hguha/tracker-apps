// The engine, exercised in complete isolation: in-memory SyncDeps, a mock backend,
// and a made-up (non-workout) schema. This is what proves @tracker-engine/local-first
// is truly app-agnostic — the app's own integration test (reputation) covers the real
// Dexie/workout wiring separately.

import { beforeEach, describe, expect, it } from 'vitest'
import { SyncEngine } from '../src/engine'
import type { SyncRowStore, SyncSchema } from '../src/schema'
import type { DeadLetterEntry, OutboxEntry, SyncDeps, SyncState } from '../src/types'
import type { PulledRow, PushOutcome, PushRow, SyncBackend } from '../src/backend'

function memStore() {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    rows,
    put: async (r: Record<string, unknown>) => void rows.set(String(r.id), r),
    get: async (id: string) => rows.get(id),
  } satisfies SyncRowStore & { rows: Map<string, Record<string, unknown>> }
}

// In-memory implementation of the three persistence ports the engine is injected with.
function memDeps() {
  const outbox: OutboxEntry[] = []
  const deadLetter: DeadLetterEntry[] = []
  const syncState = new Map<string, SyncState>()
  let seq = 1
  const enqueue = (table: string, rowId: string) =>
    void outbox.push({ seq: seq++, table, rowId, queuedAt: 0, attempts: 0 })

  const deps: SyncDeps = {
    outbox: {
      toArray: async () => outbox.map((e) => ({ ...e })),
      delete: async (s) => {
        const i = outbox.findIndex((e) => e.seq === s)
        if (i >= 0) outbox.splice(i, 1)
      },
      update: async (s, changes) => {
        const e = outbox.find((x) => x.seq === s)
        if (e) Object.assign(e, changes)
        return 1
      },
      clear: async () => void (outbox.length = 0),
      count: async () => outbox.length,
    },
    deadLetter: {
      toArray: async () => deadLetter.map((e) => ({ ...e })),
      delete: async (s) => {
        const i = deadLetter.findIndex((e) => e.seq === s)
        if (i >= 0) deadLetter.splice(i, 1)
      },
      clear: async () => void (deadLetter.length = 0),
      count: async () => deadLetter.length,
    },
    syncState: {
      get: async (t) => syncState.get(t),
      put: async (st) => void syncState.set(st.table, st),
      clear: async () => syncState.clear(),
    },
    moveToDeadLetter: async (s, entry) => {
      deadLetter.push({ ...entry, seq: seq++ })
      const i = outbox.findIndex((e) => e.seq === s)
      if (i >= 0) outbox.splice(i, 1)
    },
    enqueue: async (table, rowId) => enqueue(table, rowId),
    reportError: () => {},
  }
  return { deps, outbox, deadLetter, enqueue }
}

class FakeBackend implements SyncBackend {
  readonly pushed: PushRow[] = []
  toPull: Record<string, PulledRow[]> = {}
  private fail: Record<string, PushOutcome> = {}
  failTable(table: string, outcome: PushOutcome) {
    this.fail[table] = outcome
  }
  async push(row: PushRow): Promise<PushOutcome> {
    this.pushed.push(row)
    return this.fail[row.table] ?? { status: 'ok' }
  }
  async pull(table: string, since: number): Promise<PulledRow[]> {
    return (this.toPull[table] ?? []).filter((r) => Number(r.row.updatedAt ?? 0) > since)
  }
  async hardDeleteAll(): Promise<{ ok: true }> {
    return { ok: true }
  }
}

// A toy two-table schema: `notes` is client-authored, `feed` is server-authored (pull-only).
function makeSchema() {
  const stores = { notes: memStore(), feed: memStore() }
  const schema: SyncSchema = {
    tables: ['notes', 'feed'],
    parentIdOf: () => undefined,
    normalize: (t, row) => (t === 'notes' ? { ...row, tag: row.tag ?? 'default' } : row),
    store: (t) => {
      const s = stores[t as keyof typeof stores]
      if (!s) throw new Error(`no store for ${t}`)
      return s
    },
    eraseOrder: ['feed', 'notes'],
    serverAuthored: ['feed'],
  }
  return { schema, stores }
}

let backend: FakeBackend
beforeEach(() => {
  backend = new FakeBackend()
})

describe('SyncEngine (isolated, injected deps)', () => {
  it('pull routes rows through schema.store and normalize', async () => {
    const { schema, stores } = makeSchema()
    const { deps } = memDeps()
    backend.toPull.notes = [{ table: 'notes', row: { id: 'n1', updatedAt: 5 } }]

    const applied = await new SyncEngine(backend, schema, deps).pull()

    expect(applied).toEqual({ applied: 1 })
    expect(stores.notes.rows.get('n1')).toMatchObject({ id: 'n1', tag: 'default' })
  })

  it('drain pushes client-authored rows and never server-authored ones', async () => {
    const { schema, stores } = makeSchema()
    const { deps, enqueue, outbox } = memDeps()
    stores.notes.rows.set('n1', { id: 'n1' })
    stores.feed.rows.set('f1', { id: 'f1' })
    enqueue('notes', 'n1')
    enqueue('feed', 'f1')

    await new SyncEngine(backend, schema, deps).drain()

    expect(backend.pushed.map((p) => p.table)).toEqual(['notes'])
    // The server-authored entry was left in the queue, not sent.
    expect(outbox.map((e) => e.table)).toEqual(['feed'])
  })

  it('dead-letters a row the server rejects permanently', async () => {
    const { schema, stores } = makeSchema()
    const { deps, enqueue, deadLetter } = memDeps()
    stores.notes.rows.set('n1', { id: 'n1' })
    enqueue('notes', 'n1')
    backend.failTable('notes', { status: 'permanent', error: 'RLS' })

    const result = await new SyncEngine(backend, schema, deps).drain()

    expect(result.deadLettered).toBe(1)
    expect(deadLetter).toHaveLength(1)
    expect(deadLetter[0]).toMatchObject({ table: 'notes', rowId: 'n1', error: 'RLS' })
  })
})
