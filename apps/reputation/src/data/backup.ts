// Full client-side JSON export/import of a user's data (§11.3, §5.6). Import is
// additive by key (bulkPut on client ids): idempotent, merges, never deletes omissions.

import {
  BackupParseError,
  backupRows,
  importBackupRows,
  parseBackupObject,
} from '@tracker-engine/local-first'
import { db } from '@/db/database'
import { enqueue } from './outbox'
import { rebuildDerivedFor } from './records'
import { getActiveUserId } from '@/db/seed'
import { RETIRED_BODYWEIGHT_TRACKING } from './migrations/exerciseModel'
import type {
  Exercise,
  MetricEntry,
  PersonalRecord,
  Profile,
  Template,
  TemplateExercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/domain/types'

/** Bumped only on a breaking shape change; the importer refuses a newer major. */
const BACKUP_VERSION = 1

export interface BackupFile {
  format: 'fitnote-backup'
  version: number
  exportedAt: number
  data: {
    profile: Profile | null
    /** Custom (user-authored) exercises only — the system library re-seeds. */
    exercises: Exercise[]
    templates: Template[]
    templateExercises: TemplateExercise[]
    workouts: Workout[]
    workoutExercises: WorkoutExercise[]
    sets: WorkoutSet[]
    personalRecords: PersonalRecord[]
    metricEntries: MetricEntry[]
  }
}

export interface BackupCounts {
  exercises: number
  templates: number
  workouts: number
  sets: number
  metricEntries: number
}

export function countsOf(file: BackupFile): BackupCounts {
  return {
    exercises: file.data.exercises.length,
    templates: file.data.templates.length,
    workouts: file.data.workouts.length,
    sets: file.data.sets.length,
    metricEntries: file.data.metricEntries.length,
  }
}

// Filters out soft-deleted rows so a backup is a clean snapshot, not a tombstone archive.
export async function buildBackup(now = Date.now()): Promise<BackupFile> {
  const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
    rows.filter((r) => r.deletedAt === null)

  const [
    profile,
    exercises,
    templates,
    templateExercises,
    workouts,
    workoutExercises,
    sets,
    personalRecords,
    metricEntries,
  ] = await Promise.all([
    db.profiles.get(getActiveUserId()),
    db.exercises.filter((e) => e.userId !== null).toArray(),
    db.templates.toArray(),
    db.templateExercises.toArray(),
    db.workouts.toArray(),
    db.workoutExercises.toArray(),
    db.sets.toArray(),
    db.personalRecords.toArray(),
    db.metricEntries.toArray(),
  ])

  return {
    format: 'fitnote-backup',
    version: BACKUP_VERSION,
    exportedAt: now,
    data: {
      profile: profile ?? null,
      exercises: live(exercises),
      templates: live(templates),
      templateExercises: live(templateExercises),
      workouts: live(workouts),
      workoutExercises: live(workoutExercises),
      sets: live(sets),
      personalRecords: live(personalRecords),
      metricEntries: live(metricEntries),
    },
  }
}

export async function exportToJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2)
}

export function backupFilename(isoDate: string): string {
  return `fitnote-backup-${isoDate}.json`
}

export { BackupParseError }

function isRetiredBodyweightTracking(value: unknown): boolean {
  return typeof value === 'string' && RETIRED_BODYWEIGHT_TRACKING.has(value)
}

function normalizeTrackingType(value: unknown): Exercise['trackingType'] {
  return isRetiredBodyweightTracking(value)
    ? 'bodyweight_reps'
    : (value as Exercise['trackingType'])
}

// Strict about the envelope but lenient about extra fields, so a newer minor still imports.
export function parseBackup(json: string): BackupFile {
  const obj = parseBackupObject(json, 'That file is not a REPutation backup.')
  if (obj.format !== 'fitnote-backup') {
    throw new BackupParseError('That file is not a REPutation backup.')
  }
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new BackupParseError(
      'This backup was made by a newer version of REPutation. Update the app, then import.',
    )
  }
  if (typeof obj.data !== 'object' || obj.data === null) {
    throw new BackupParseError('This backup is missing its data.')
  }

  // Normalize: tolerate a file that predates a table by defaulting it to empty,
  // and drop any row without a string primary key. A row missing its `id` throws
  // on bulkPut (the key is inline), and a hand-edited file is untrusted input —
  // so keep only rows the DB can actually store rather than trusting the shape.
  const d = obj.data as Record<string, unknown>
  const rows = backupRows
  const profile = d.profile
  return {
    format: 'fitnote-backup',
    version: obj.version,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    data: {
      profile:
        typeof profile === 'object' && profile !== null ? (profile as Profile) : null,
      exercises: rows<Exercise>(d.exercises).map((e) => ({
        ...e,
        aliases: Array.isArray(e.aliases) ? e.aliases : [],
        // A backup made before the bodyweight tracking types were collapsed can
        // carry a retired value; coerce it so it never reaches a tracking-type
        // switch. The load mode itself is backfilled by migrateExerciseModel.
        trackingType: normalizeTrackingType(e.trackingType),
        bodyweightFactor: isRetiredBodyweightTracking(e.trackingType)
          ? (e.bodyweightFactor ?? 1)
          : e.bodyweightFactor,
      })),
      templates: rows<Template>(d.templates),
      templateExercises: rows<TemplateExercise>(d.templateExercises),
      workouts: rows<Workout>(d.workouts),
      workoutExercises: rows<WorkoutExercise>(d.workoutExercises),
      sets: rows<WorkoutSet>(d.sets),
      personalRecords: rows<PersonalRecord>(d.personalRecords),
      metricEntries: rows<MetricEntry>(d.metricEntries),
    },
  }
}

// Re-stamps rows to the active user (the id RLS checks; a foreign owner id would make
// them invisible) but preserves ids, in one transaction so a bad row can't half-write.
export async function importBackup(file: BackupFile): Promise<BackupCounts> {
  const userId = getActiveUserId()
  const { data } = file
  const owned = <T>(rows: T[]) => rows.map((row) => ({ ...row, userId }))

  // The system library (userId null) is never in the file, so custom exercises
  // are safe to re-stamp with the active id, as are all other user-scoped rows.
  await importBackupRows({
    tables: [
      {
        table: 'profiles',
        store: db.profiles,
        rows: data.profile ? [{ ...data.profile, id: userId }] : [],
      },
      { table: 'exercises', store: db.exercises, rows: owned(data.exercises) },
      { table: 'templates', store: db.templates, rows: owned(data.templates) },
      { table: 'templateExercises', store: db.templateExercises, rows: data.templateExercises },
      { table: 'workouts', store: db.workouts, rows: owned(data.workouts) },
      { table: 'workoutExercises', store: db.workoutExercises, rows: data.workoutExercises },
      { table: 'sets', store: db.sets, rows: data.sets },
      {
        table: 'personalRecords',
        store: db.personalRecords,
        rows: data.personalRecords,
        isSynced: false,
      },
      { table: 'metricEntries', store: db.metricEntries, rows: owned(data.metricEntries) },
    ],
    inTransaction: (work) => db.transaction('rw', db.tables, work),
    enqueue,
  })

  await rebuildDerivedFor(data.workoutExercises)

  return countsOf(file)
}
