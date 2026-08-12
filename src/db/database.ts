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
   * The full row, not just the changed fields. The push is an upsert, which
   * PostgREST issues as INSERT ... ON CONFLICT DO UPDATE, and Postgres checks
   * the INSERT policy against the proposed tuple — so a partial payload is
   * missing `user_id` and RLS rejects it. Typed loosely because it holds a row
   * from any table; the repository guarantees the shape matches `table`.
   */
  payload: object
  clientRev: number
  queuedAt: number
  attempts: number
  lastError?: string
  /** Earliest time to retry after a transient failure. Set by the drain's backoff. */
  nextAttemptAt?: number
  /**
   * The workout this write belongs to, when it's part of a session that is still
   * in progress (§5.5). The drain skips these until the workout is finished, so a
   * half-logged session never reaches the server — which is what made two devices
   * disagree about whether a workout was active or done. Cleared on finish.
   */
  deferredForWorkoutId?: string
}

/**
 * Ready to push now. A deferred entry belongs to a workout still in progress, so
 * it's held back until Finish — see `deferredForWorkoutId`.
 */
export const isReadyToPush = (entry: OutboxEntry): boolean =>
  entry.deferredForWorkoutId === undefined

/** Per-table high-water marks for delta pulls. */
export interface SyncState {
  table: string
  lastPulledAt: number
}

/**
 * An outbox entry that failed permanently (§5.5).
 *
 * A 4xx (other than 401/429) means the write will never succeed as-is — a poison
 * entry left in the outbox would silently block every write behind it, the
 * classic hand-rolled-queue failure. So it moves here, out of the drain path,
 * and is surfaced in Settings for the user to see rather than retried forever.
 */
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

/**
 * A pre-edit copy of one past workout, so editing it can be cancelled (§6.6).
 *
 * Every mutation writes to IndexedDB immediately — that's what makes the app
 * work offline — so "cancel" can't mean "don't save yet". It means "put back what
 * was there", which requires having kept it.
 *
 * Its existence also marks the workout as *being edited*, which the outbox
 * deferral reads: nothing is pushed to the server until Done, so a cancelled
 * edit never reaches another device. Durable rather than in-memory precisely
 * because a reload mid-edit must not silently publish half an edit.
 */
export interface EditSnapshot {
  workoutId: string
  workout: Workout
  workoutExercises: WorkoutExercise[]
  sets: WorkoutSet[]
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

    // v3 adds the dead-letter table (§5.5). Additive, so existing data upgrades
    // untouched — Dexie carries every prior store forward automatically.
    this.version(3).stores({
      deadLetter: '++seq, table, rowId',
    })

    // v4 indexes the outbox's deferral marker, so the drain can select only the
    // entries that are actually ready to push. Additive: existing entries simply
    // have no value for it, which reads as "not deferred".
    this.version(4).stores({
      outbox: '++seq, table, rowId, deferredForWorkoutId',
    })

    // v5 adds the pre-edit snapshot that backs "cancel edits" (§6.6). Additive.
    this.version(5).stores({
      editSnapshots: 'workoutId',
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
