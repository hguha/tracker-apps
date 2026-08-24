// Ledger's SyncSchema — the finance counterpart to REPutation's repSchema; the same
// engine reads it. The headline difference: bank `accounts` + `transactions` are
// SERVER-AUTHORED (the aggregation server owns them), so the drain never pushes them.
// Everything the user owns — manual entries, categories, budgets, category overrides,
// the profile — is client-authored and drains normally.

import { db } from '@/db'
import type { SyncRowStore, SyncSchema } from '@tracker-engine/local-first'

const STORES: Record<string, SyncRowStore> = {
  categories: db.categories as unknown as SyncRowStore,
  budgets: db.budgets as unknown as SyncRowStore,
  entries: db.entries as unknown as SyncRowStore,
  categoryOverrides: db.categoryOverrides as unknown as SyncRowStore,
  accounts: db.accounts as unknown as SyncRowStore,
  transactions: db.transactions as unknown as SyncRowStore,
}

// `profile` is intentionally absent: it's a single device-local row (id 'me'), so it
// never pushes (a shared server table keyed by 'me' would collide across users). App
// appearance is therefore per-device for now.
export const ledgerSyncSchema: SyncSchema = {
  // Client-authored first (these drain), then the pull-only bank tables.
  tables: ['categories', 'budgets', 'entries', 'categoryOverrides', 'accounts', 'transactions'],

  // A transaction depends on its account; a budget on its category; an entry on its
  // (optional) account. Push parents before children.
  parentIdOf: (table, row) => {
    if (table === 'transactions' && typeof row.accountId === 'string') return row.accountId
    if (table === 'entries' && typeof row.accountId === 'string') return row.accountId
    if (table === 'budgets' && typeof row.categoryId === 'string') return row.categoryId
    return undefined
  },

  store: (table) => {
    const store = STORES[table]
    if (!store) throw new Error(`No local store for synced table "${table}"`)
    return store
  },

  // Delete children before parents.
  eraseOrder: [
    'transactions',
    'categoryOverrides',
    'entries',
    'budgets',
    'accounts',
    'categories',
  ],

  // Bank data the client doesn't own — pulled, never pushed.
  serverAuthored: ['accounts', 'transactions'],
}
