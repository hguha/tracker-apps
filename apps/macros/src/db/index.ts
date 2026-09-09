import Dexie, { type EntityTable } from 'dexie'
import type { DeadLetterEntry, OutboxEntry, SyncState } from '@tracker-engine/local-first'
import { createOwnerGuard } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import type {
  BodyWeightRow,
  CustomFood,
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
  customFoods!: EntityTable<CustomFood, 'id'>
  logEntries!: EntityTable<LogEntry, 'id'>
  bodyWeights!: EntityTable<BodyWeightRow, 'id'>
  recipes!: EntityTable<Recipe, 'id'>
  mealTemplates!: EntityTable<MealTemplate, 'id'>
  programs!: EntityTable<Program, 'id'>
  checkIns!: EntityTable<CheckIn, 'id'>
  profiles!: EntityTable<Profile, 'id'>
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
      profiles: 'id, updatedAt, userId',
      outbox: '++seq, table, rowId, [table+rowId]',
      deadLetter: '++seq, table, rowId',
      syncState: 'table',
    })

    // v2 adds the user's own foods. A separate store from `foods` because it's owned data:
    // the owner guard wipes it on a foreign sign-in, and reference data must survive that.
    this.version(2).stores({
      customFoods: 'id, description, barcode, updatedAt, userId',
    })
  }
}

export const db = new MacrosDatabase()

/** Everything a foreign account's sign-in must clear. `foods` is excluded on purpose:
 *  shared reference data, owned by nobody, and expensive to re-seed. */
const OWNED_TABLES = [
  db.customFoods,
  db.logEntries,
  db.bodyWeights,
  db.recipes,
  db.mealTemplates,
  db.programs,
  db.checkIns,
  db.profiles,
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
