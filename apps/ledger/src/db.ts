// Local-first store, exactly REPutation's shape: domain tables + the sync scaffolding
// (outbox / deadLetter / syncState), whose types come straight from @tracker-engine.

import Dexie, { type EntityTable } from 'dexie'
import type { DeadLetterEntry, OutboxEntry, SyncState } from '@tracker-engine/local-first'
import type { Account, Category, Transaction } from './domain'

export class LedgerDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  deadLetter!: EntityTable<DeadLetterEntry, 'seq'>
  syncState!: EntityTable<SyncState, 'table'>

  constructor(name = 'ledger') {
    super(name)
    this.version(1).stores({
      accounts: 'id, updatedAt',
      transactions: 'id, accountId, categoryId, date, updatedAt',
      categories: 'id, updatedAt',
      outbox: '++seq, table, rowId, [table+rowId]',
      deadLetter: '++seq, table, rowId',
      syncState: 'table',
    })
  }
}

export const db = new LedgerDatabase()
