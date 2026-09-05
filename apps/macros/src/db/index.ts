import Dexie, { type EntityTable } from 'dexie'
import type { DeadLetterEntry, OutboxEntry, SyncState } from '@tracker-engine/local-first'
import { createOwnerGuard } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import type {
  BodyWeightRow,
  CheckIn,
  Food,
  LogEntry,
  MealTemplate,
  Profile,
  Program,
  Recipe,
} from '@/domain/types'

// Load-bearing identifiers — keep stable across releases.
export const DB_NAME = 'macros'
const OWNER_KEY = 'macros.owner'

export class MacrosDatabase extends Dexie {
  foods!: EntityTable<Food, 'id'>
  logEntries!: EntityTable<LogEntry, 'id'>
  bodyWeights!: EntityTable<BodyWeightRow, 'id'>
  recipes!: EntityTable<Recipe, 'id'>
  mealTemplates!: EntityTable<MealTemplate, 'id'>
  programs!: EntityTable<Program, 'id'>
  checkIns!: EntityTable<CheckIn, 'id'>
  profile!: EntityTable<Profile, 'id'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  deadLetter!: EntityTable<DeadLetterEntry, 'seq'>
  syncState!: EntityTable<SyncState, 'table'>

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({
      foods: 'id, barcode, description, source, updatedAt',
      logEntries: 'id, day, [day+meal], eatenAt, foodId, recipeId, updatedAt, userId',
      bodyWeights: 'id, day, updatedAt, userId',
      recipes: 'id, name, *tags, updatedAt, userId',
      mealTemplates: 'id, name, updatedAt, userId',
      programs: 'id, startedAt, updatedAt, userId',
      checkIns: 'id, weekStart, updatedAt, userId',
      profile: 'id',
      outbox: '++seq, table, rowId, [table+rowId]',
      deadLetter: '++seq, table, rowId',
      syncState: 'table',
    })
  }
}

export const db = new MacrosDatabase()

/** Everything a foreign account's sign-in must clear. `foods` is excluded on purpose:
 *  shared reference data, owned by nobody, and expensive to re-seed. */
const OWNED_TABLES = [
  db.logEntries,
  db.bodyWeights,
  db.recipes,
  db.mealTemplates,
  db.programs,
  db.checkIns,
  db.profile,
  db.outbox,
  db.deadLetter,
  db.syncState,
]

export const owner = createOwnerGuard({
  storageKey: OWNER_KEY,
  tables: OWNED_TABLES,
  localUserId: LOCAL_USER_ID,
  // `claim` is wired in data/repository.ts, which owns the write path.
})
