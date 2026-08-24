// The local database: IndexedDB is the authoritative read path (§5.5); the UI never awaits the network.

import Dexie, { type EntityTable } from 'dexie'
import type {
  Exercise,
  LastPerformance,
  MetricDefinition,
  MetricEntry,
  PersonalRecord,
  Profile,
  Template,
  TemplateExercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/domain/types'
import {
  isReadyToPush,
  syncStamp,
  touch,
  type DeadLetterEntry,
  type OutboxEntry,
  type SyncState,
} from '@tracker-engine/local-first'

// Generic sync scaffolding now lives in @tracker-engine/local-first; re-exported so app code
// keeps importing these from '@/db/database' unchanged.
export { isReadyToPush, syncStamp, touch }
export type { DeadLetterEntry, OutboxEntry, SyncState }

// Per-set placeholder hints for a repeated session (§7.2); local-only and never synced.
export interface PlaceholderOverrides {
  workoutId: string
  placeholders: Record<
    string,
    {
      weightKg: number | null
      reps: number | null
      durationSeconds: number | null
      distanceM: number | null
    }
  >
  createdAt: number
}

// A pre-edit copy of one past workout so editing can be cancelled (§6.6); its
// existence also marks the workout as being edited, which the outbox deferral reads.
export interface EditSnapshot {
  workoutId: string
  workout: Workout
  workoutExercises: WorkoutExercise[]
  sets: WorkoutSet[]
  createdAt: number
}

// A persisted coach chat (local-only, never synced — it's device UI state, not
// domain data). `contents` is the Gemini conversation and `items` the display
// messages/cards; both are structured-clone-safe, typed loose here to keep the db
// layer decoupled from the coach feature types.
export interface StoredCoachConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  contents: unknown[]
  items: unknown[]
}

export class WorkoutDatabase extends Dexie {
  profiles!: EntityTable<Profile, 'id'>
  exercises!: EntityTable<Exercise, 'id'>
  workouts!: EntityTable<Workout, 'id'>
  workoutExercises!: EntityTable<WorkoutExercise, 'id'>
  sets!: EntityTable<WorkoutSet, 'id'>
  templates!: EntityTable<Template, 'id'>
  templateExercises!: EntityTable<TemplateExercise, 'id'>
  personalRecords!: EntityTable<PersonalRecord, 'id'>
  metricDefinitions!: EntityTable<MetricDefinition, 'id'>
  metricEntries!: EntityTable<MetricEntry, 'id'>
  lastPerformance!: EntityTable<LastPerformance, 'exerciseId'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  deadLetter!: EntityTable<DeadLetterEntry, 'seq'>
  syncState!: EntityTable<SyncState, 'table'>
  placeholderOverrides!: EntityTable<PlaceholderOverrides, 'workoutId'>
  editSnapshots!: EntityTable<EditSnapshot, 'workoutId'>
  coachConversations!: EntityTable<StoredCoachConversation, 'id'>

  constructor(name = 'workout-tracker') {
    super(name)

    this.version(2).stores({
      profiles: 'id',
      muscles: 'id, region, userId',
      exercises:
        'id, name, primaryMuscleId, movementPattern, equipment, userId, isKeyLift',
      workouts: 'id, startedAt, endedAt, templateId',
      workoutExercises: 'id, workoutId, exerciseId, [workoutId+position]',
      sets: 'id, workoutExerciseId, [workoutExerciseId+position], completedAt',
      templates: 'id, name, folder, lastUsedAt',
      templateExercises: 'id, templateId, [templateId+position]',
      personalRecords: 'id, exerciseId, [exerciseId+recordType], achievedAt',
      metricDefinitions: 'id, key, category',
      metricEntries: 'id, definitionId, [definitionId+measuredAt], measuredAt',
      lastPerformance: 'exerciseId',
      outbox: '++seq, table, rowId',
      syncState: 'table',
      placeholderOverrides: 'workoutId',
    })

    // v3 adds the dead-letter table (§5.5).
    this.version(3).stores({
      deadLetter: '++seq, table, rowId',
    })

    // v4 indexes the outbox's deferral marker so the drain selects only ready entries.
    this.version(4).stores({
      outbox: '++seq, table, rowId, deferredForWorkoutId',
    })

    // v5 adds the pre-edit snapshot that backs "cancel edits" (§6.6).
    this.version(5).stores({
      editSnapshots: 'workoutId',
    })

    // v6 makes equipment a dimension of the workout rather than the exercise:
    // WorkoutExercise/TemplateExercise carry equipment; records and last-time are
    // keyed per (exercise + equipment). The data repoint from equipment-named
    // exercises to base exercises runs in migrateToBaseExercises() on launch,
    // after seeding — Dexie upgrade hooks can't reach the seed/derivation.
    //
    // lastPerformance switches its primary key from exerciseId to a composite id,
    // which Dexie can't do in place ("changing primary key"). It's a pure cache
    // rebuilt from history, so v6 drops it and v7 recreates it under the new key.
    this.version(6).stores({
      exercises: 'id, name, primaryMuscleId, movementPattern, userId, isKeyLift',
      workoutExercises: 'id, workoutId, exerciseId, [workoutId+position]',
      personalRecords:
        'id, exerciseId, [exerciseId+equipment], [exerciseId+equipment+recordType], achievedAt',
      lastPerformance: null,
    })

    this.version(7).stores({
      lastPerformance: 'id, exerciseId',
    })

    // v8 collapses the muscle taxonomy: an exercise stores its region directly
    // instead of pointing at a row in a separate `muscles` table. The backfill
    // from primaryMuscleId to region runs in the upgrade hook, since the region
    // for a retired muscle id can't be recovered once the table is gone.
    this.version(8)
      .stores({
        exercises: 'id, name, region, movementPattern, userId, isKeyLift',
        muscles: null,
      })
      .upgrade(async (tx) => {
        const muscles = await tx.table('muscles').toArray()
        const regionOf = new Map<string, string>(
          muscles.map((m: { id: string; region: string }) => [m.id, m.region]),
        )
        await tx
          .table('exercises')
          .toCollection()
          .modify((exercise: Record<string, unknown>) => {
            const muscleId = exercise.primaryMuscleId as string | undefined
            // Seeding has run on every prior launch, so the lookup hits; 'core'
            // only guards a row pointing at a muscle that was never seeded.
            exercise.region =
              (muscleId !== undefined ? regionOf.get(muscleId) : undefined) ?? 'core'
            delete exercise.primaryMuscleId
          })
      })

    // v9 makes the outbox one entry per dirty row instead of a log of edits: the
    // [table+rowId] index is what lets enqueue refresh in place. Existing queues
    // are collapsed to their earliest entry per row (seq order is the push order,
    // so the earliest keeps parents ahead of children) and the frozen payload /
    // op / clientRev are dropped — the drain reads the live row now.
    this.version(9)
      .stores({
        outbox: '++seq, table, rowId, [table+rowId], deferredForWorkoutId',
      })
      .upgrade(async (tx) => {
        const outbox = tx.table('outbox')
        const seen = new Set<string>()
        const duplicates: number[] = []
        for (const entry of (await outbox.orderBy('seq').toArray()) as {
          seq: number
          table: string
          rowId: string
        }[]) {
          const key = `${entry.table}:${entry.rowId}`
          if (seen.has(key)) duplicates.push(entry.seq)
          else seen.add(key)
        }
        await outbox.bulkDelete(duplicates)
        await outbox.toCollection().modify((entry: Record<string, unknown>) => {
          delete entry.op
          delete entry.payload
          delete entry.clientRev
        })

        await tx
          .table('deadLetter')
          .toCollection()
          .modify((entry: Record<string, unknown>) => {
            entry.row = entry.payload ?? {}
            entry.attempts = entry.attempts ?? 0
            delete entry.payload
            delete entry.op
            delete entry.clientRev
          })
      })

    // v10 adds local-only persisted coach conversations (§13). Not synced.
    this.version(10).stores({
      coachConversations: 'id, updatedAt',
    })
  }
}

export const db = new WorkoutDatabase()
