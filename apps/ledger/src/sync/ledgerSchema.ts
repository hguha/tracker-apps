// Ledger's SyncSchema — the finance counterpart to REPutation's repSchema. The same
// engine reads it. The headline difference: accounts + transactions are SERVER-AUTHORED
// (pulled from the bank via aggregation), so the drain never pushes them; only the
// client-authored `categories` drain.

import { db } from '../db'
import type { SyncRowStore, SyncSchema } from '@tracker-engine/local-first'

const STORES: Record<string, SyncRowStore> = {
  accounts: db.accounts as unknown as SyncRowStore,
  transactions: db.transactions as unknown as SyncRowStore,
  categories: db.categories as unknown as SyncRowStore,
}

export const ledgerSyncSchema: SyncSchema = {
  // Client-authored first (drains), then the pull-only bank tables.
  tables: ['categories', 'accounts', 'transactions'],

  parentIdOf: (table, row) =>
    table === 'transactions' && typeof row.accountId === 'string' ? row.accountId : undefined,

  store: (table) => {
    const store = STORES[table]
    if (!store) throw new Error(`No local store for synced table "${table}"`)
    return store
  },

  eraseOrder: ['transactions', 'accounts', 'categories'],

  // Bank data the client doesn't own — pulled, never pushed.
  serverAuthored: ['accounts', 'transactions'],
}
