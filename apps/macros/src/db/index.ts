import Dexie, { type EntityTable } from 'dexie'
import type { DeadLetterEntry, OutboxEntry, SyncState } from '@tracker-engine/local-first'
import { createOwnerGuard } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import { entryChangeTracker } from './entryChanges'
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
  WaterRow,
} from '@/domain/types'

// Load-bearing identifiers — keep stable across releases.
export const DB_NAME = 'macros'
const OWNER_KEY = 'macros.owner'

export class MacrosDatabase extends Dexie {
  foods!: EntityTable<Food, 'id'>
  customFoods!: EntityTable<CustomFood, 'id'>
  logEntries!: EntityTable<LogEntry, 'id'>
  bodyWeights!: EntityTable<BodyWeightRow, 'id'>
  waterLogs!: EntityTable<WaterRow, 'id'>
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

    // v3 indexes recipes by cuisine and entries by venue, both of which are filtered on. No
    // upgrade function: the new fields are nullable, and Dexie leaves a missing key out of its
    // index rather than storing null, so an old row is simply absent from a filtered result —
    // which is what "not recorded" should mean anyway.
    this.version(3).stores({
      recipes: 'id, name, cuisine, *tags, updatedAt, userId',
      logEntries: 'id, day, [day+meal], eatenAt, foodId, recipeId, venue, updatedAt, userId',
    })

    /**
     * v4 backfills the goal-weight fields onto programs that predate them.
     *
     * This one needs an upgrade function where v3's didn't, and the difference is what the code
     * checks. A missing `venue` reads as `undefined`, and every venue check is `!== null` or a
     * truthiness test, so absent behaves as unset. `targetKg` is checked with `=== null` to mean
     * "no goal set" — and `undefined === null` is false, so an older program fell through to the
     * has-a-goal branch and rendered `NaN lb goal`, then put "NaN" in the Targets field.
     *
     * The lesson is about the check, not the migration: a nullable field added to a live store has
     * two empty values, and code that only handles one of them is broken for every existing row.
     */
    this.version(4).upgrade(async (tx) =>
      tx
        .table('programs')
        .toCollection()
        .modify((program: Record<string, unknown>) => {
          program.targetKg ??= null
          program.startKg ??= null
          program.reachedAt ??= null
        }),
    )

    /**
     * v5 adds water and dish grouping.
     *
     * `logEntries` gains a `dishId` index so a dish's rows are one lookup. The upgrade backfills
     * both dish columns and the two new profile fields for the same reason v4 existed: code that
     * distinguishes "no dish" from "not yet a concept" would have to check both `null` and
     * `undefined`, and something would eventually check only one.
     */
    this.version(5)
      .stores({
        logEntries:
          'id, day, [day+meal], eatenAt, foodId, recipeId, dishId, venue, updatedAt, userId',
        waterLogs: 'id, day, updatedAt, userId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('logEntries')
          .toCollection()
          .modify((entry: Record<string, unknown>) => {
            entry.dishId ??= null
            entry.dishName ??= null
          })
        await tx
          .table('profiles')
          .toCollection()
          .modify((profile: Record<string, unknown>) => {
            profile.waterTargetMl ??= null
            profile.reminders ??= null
          })
      })
    this.use(entryChangeTracker)
  }
}

export const db = new MacrosDatabase()

/** Everything a foreign account's sign-in must clear. `foods` is excluded on purpose:
 *  shared reference data, owned by nobody, and expensive to re-seed. */
const OWNED_TABLES = [
  db.customFoods,
  db.logEntries,
  db.bodyWeights,
  db.waterLogs,
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
