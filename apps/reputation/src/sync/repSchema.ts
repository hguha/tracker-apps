// REPutation's SyncSchema: the concrete, workout-specific configuration that drives
// the generic SyncEngine. This is the code that used to live as hardcoded constants
// and helper functions inside engine.ts (SYNCED_TABLES, parentRowId, normalizeRow,
// tableStore, ERASE_ORDER); moving it here makes the engine reusable by a second app.

import { db } from '@/db/database'
import type { SyncRowStore, SyncSchema } from './schema'

// Tables that participate in sync, in dependency order for the initial pull.
// `personalRecords` is absent: PRs are derived from sets and recomputed per device.
const TABLES = [
  'profiles',
  'exercises',
  'templates',
  'templateExercises',
  'workouts',
  'workoutExercises',
  'sets',
  'metricDefinitions',
  'metricEntries',
] as const

// The Dexie store behind each synced table.
const STORES: Record<string, SyncRowStore> = {
  profiles: db.profiles,
  exercises: db.exercises,
  templates: db.templates,
  templateExercises: db.templateExercises,
  workouts: db.workouts,
  workoutExercises: db.workoutExercises,
  sets: db.sets,
  metricDefinitions: db.metricDefinitions,
  metricEntries: db.metricEntries,
} as unknown as Record<string, SyncRowStore>

export const repSyncSchema: SyncSchema = {
  tables: TABLES,

  // Only the two chained workout tables have a parent; everything else stands alone.
  parentIdOf(table, row) {
    const key =
      table === 'workoutExercises'
        ? 'workoutId'
        : table === 'sets'
          ? 'workoutExerciseId'
          : null
    if (key === null) return undefined
    const value = row[key]
    return typeof value === 'string' ? value : undefined
  },

  // Backfills domain fields a pulled row can't carry from Postgres — e.g. a missing
  // `aliases` that would throw `not iterable` and blank the screen.
  normalize(table, row) {
    if (table === 'exercises') {
      return { ...row, aliases: row.aliases ?? [] }
    }
    if (table === 'profiles') {
      // A profile from before a column existed arrives without it; backfill defaults
      // so the client never renders against undefined.
      return {
        ...row,
        weeklyWorkoutGoal: row.weeklyWorkoutGoal ?? 4,
        showAvatar: row.showAvatar ?? false,
        heightCm: row.heightCm ?? null,
        trainingGoal: row.trainingGoal ?? '',
        sex: row.sex ?? null,
        birthYear: row.birthYear ?? null,
        experienceLevel: row.experienceLevel ?? null,
        trainingDaysPerWeek: row.trainingDaysPerWeek ?? null,
        onboardedAt: row.onboardedAt ?? null,
        onboardingVersion: row.onboardingVersion ?? 0,
      }
    }
    return row
  },

  store(table) {
    const store = STORES[table]
    if (store === undefined) throw new Error(`No local store for synced table "${table}"`)
    return store
  },

  // profiles/metricDefinitions are excluded (account + shared-library system rows).
  eraseOrder: [
    'sets',
    'workoutExercises',
    'workouts',
    'templateExercises',
    'templates',
    'metricEntries',
    'exercises',
  ],

  // REPutation's client authors every synced table.
  serverAuthored: [],
}
