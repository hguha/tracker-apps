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

// Durable mutation queue (§5.5): every write goes through it so turning on sync is implementing the drain.
export interface OutboxEntry {
  seq?: number
  table: string
  op: 'insert' | 'update' | 'delete'
  rowId: string
  // The full row, not a diff: the upsert re-checks the INSERT policy, so a partial payload lacks user_id and RLS rejects it.
  payload: object
  clientRev: number
  queuedAt: number
  attempts: number
  lastError?: string
  nextAttemptAt?: number
  // Set while its workout is in progress (§5.5); the drain skips these until Finish, cleared then.
  deferredForWorkoutId?: string
}

export const isReadyToPush = (entry: OutboxEntry): boolean =>
  entry.deferredForWorkoutId === undefined

/** Per-table high-water marks for delta pulls. */
export interface SyncState {
  table: string
  lastPulledAt: number
}

// A permanently-failed entry (§5.5), moved off the drain path so a poison write can't block the queue.
export interface DeadLetterEntry {
  seq?: number
  table: string
  op: 'insert' | 'update' | 'delete'
  rowId: string
  payload: object
  clientRev: number
  queuedAt: number
  failedAt: number
  error: string
}

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
  }
}

export const db = new WorkoutDatabase()

export function syncStamp(now = Date.now()) {
  return { createdAt: now, updatedAt: now, deletedAt: null, clientRev: 1 }
}

export function touch(clientRev: number, now = Date.now()) {
  return { updatedAt: now, clientRev: clientRev + 1 }
}
