/**
 * The local database. IndexedDB is the authoritative read path (§5.5) — the UI
 * never awaits the network, so this is where every screen reads from, whether
 * or not a server is attached.
 *
 * Table and index shapes match the Postgres schema so the eventual sync layer
 * moves rows without translating them.
 */

import Dexie, { type EntityTable } from 'dexie'
import type {
  Exercise,
  LastPerformance,
  MetricDefinition,
  MetricEntry,
  Muscle,
  PersonalRecord,
  Profile,
  Template,
  TemplateExercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/domain/types'

/**
 * Durable mutation queue (§5.5). Nothing drains it in the prototype — no
 * server exists yet — but every write goes through it, so turning on sync is
 * implementing the drain rather than rewriting every mutation.
 */
export interface OutboxEntry {
  seq?: number
  table: string
  op: 'insert' | 'update' | 'delete'
  rowId: string
  /**
   * Changed fields only, so two edits to different columns of one row don't
   * clobber each other. Typed loosely because it holds a partial of any table's
   * row; the repository is what guarantees the shape matches `table`.
   */
  payload: object
  clientRev: number
  queuedAt: number
  attempts: number
  lastError?: string
}

/** Per-table high-water marks for delta pulls. */
export interface SyncState {
  table: string
  lastPulledAt: number
}

/**
 * Per-set placeholder hints for a repeated session (§7.2).
 *
 * Local-only and never synced: these describe what the UI should *suggest* for a
 * specific repeat, not anything about the workout itself. Cleaned up when the
 * workout is finished.
 */
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

export class WorkoutDatabase extends Dexie {
  profiles!: EntityTable<Profile, 'id'>
  muscles!: EntityTable<Muscle, 'id'>
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
  syncState!: EntityTable<SyncState, 'table'>
  placeholderOverrides!: EntityTable<PlaceholderOverrides, 'workoutId'>

  constructor(name = 'workout-tracker') {
    super(name)

    this.version(2).stores({
      profiles: 'id',
      muscles: 'id, region, userId',
      exercises: 'id, name, primaryMuscleId, movementPattern, equipment, userId, isKeyLift',
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
  }
}

export const db = new WorkoutDatabase()

/** Fresh sync metadata for a newly created row. */
export function syncStamp(now = Date.now()) {
  return { createdAt: now, updatedAt: now, deletedAt: null, clientRev: 1 }
}

/** Metadata patch for an edit to an existing row. */
export function touch(clientRev: number, now = Date.now()) {
  return { updatedAt: now, clientRev: clientRev + 1 }
}
