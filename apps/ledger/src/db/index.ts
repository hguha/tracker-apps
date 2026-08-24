// Local-first store: domain tables + the sync scaffolding (outbox / deadLetter /
// syncState), whose types come straight from @tracker-engine/local-first. IndexedDB
// is the source of truth; sync reconciles it against Supabase in the background.

import Dexie, { type EntityTable } from 'dexie'
import type { DeadLetterEntry, OutboxEntry, SyncState } from '@tracker-engine/local-first'
import type {
  Account,
  Budget,
  Category,
  CategoryOverride,
  Entry,
  Profile,
  Transaction,
} from '@/domain/types'

// Load-bearing identifiers — keep stable across releases.
export const DB_NAME = 'ledger'
const OWNER_KEY = 'ledger.owner'

export class LedgerDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  entries!: EntityTable<Entry, 'id'>
  categoryOverrides!: EntityTable<CategoryOverride, 'id'>
  categories!: EntityTable<Category, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  profile!: EntityTable<Profile, 'id'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  deadLetter!: EntityTable<DeadLetterEntry, 'seq'>
  syncState!: EntityTable<SyncState, 'table'>

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({
      accounts: 'id, updatedAt',
      transactions: 'id, accountId, categoryId, date, updatedAt',
      entries: 'id, accountId, categoryId, date, updatedAt',
      categoryOverrides: 'id, updatedAt',
      categories: 'id, updatedAt',
      budgets: 'id, categoryId, updatedAt',
      profile: 'id',
      outbox: '++seq, table, rowId, [table+rowId]',
      deadLetter: '++seq, table, rowId',
      syncState: 'table',
    })
  }
}

export const db = new LedgerDatabase()

// Every domain/sync table, for a full wipe when the signed-in account changes.
const DOMAIN_TABLES = [
  db.accounts,
  db.transactions,
  db.entries,
  db.categoryOverrides,
  db.categories,
  db.budgets,
  db.profile,
  db.outbox,
  db.deadLetter,
  db.syncState,
]

/**
 * Guards against showing one account's data to another on the same device. On
 * sign-in the caller passes the owner id; if it differs from the last owner, the
 * local store is wiped before any screen reads it. A fresh app (no financial data
 * yet), so a clean per-account start is the safe, simple policy — no claim/merge.
 * Returns true when a wipe happened.
 */
export async function assertDbOwner(ownerId: string): Promise<boolean> {
  const previous = localStorage.getItem(OWNER_KEY)
  if (previous === ownerId) return false
  if (previous !== null) {
    await Promise.all(DOMAIN_TABLES.map((t) => t.clear()))
  }
  localStorage.setItem(OWNER_KEY, ownerId)
  return previous !== null
}
