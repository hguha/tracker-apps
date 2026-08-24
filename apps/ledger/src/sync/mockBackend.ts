// Stands in for the Plaid-fed server: seeded with bank accounts + transactions the
// engine pulls, and records what the client pushes (so we can show categories push
// while bank rows never do). Implements the same SyncBackend the Supabase backend does.

import type { PulledRow, PushOutcome, PushRow, SyncBackend } from '@tracker-engine/local-first'

type Table = Map<string, Record<string, unknown>>

export class MockBankBackend implements SyncBackend {
  private store = new Map<string, Table>()
  readonly pushed: PushRow[] = []

  seed(table: string, rows: Record<string, unknown>[]): void {
    const t = this.store.get(table) ?? new Map()
    for (const r of rows) t.set(String(r.id), r)
    this.store.set(table, t)
  }

  async push(row: PushRow): Promise<PushOutcome> {
    this.pushed.push(row)
    const t = this.store.get(row.table) ?? new Map()
    t.set(row.rowId, { ...row.row, id: row.rowId })
    this.store.set(row.table, t)
    return { status: 'ok' }
  }

  async pull(table: string, since: number): Promise<PulledRow[]> {
    const rows = [...(this.store.get(table)?.values() ?? [])]
    return rows
      .filter((r) => Number(r.updatedAt ?? 0) > since)
      .sort((a, b) => Number(a.updatedAt ?? 0) - Number(b.updatedAt ?? 0))
      .map((row) => ({ table, row }))
  }

  async hardDeleteAll(table: string): Promise<{ ok: true }> {
    this.store.delete(table)
    return { ok: true }
  }
}
