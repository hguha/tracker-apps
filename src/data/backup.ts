/**
 * Full JSON export and import of a user's data (§11.3, §5.6).
 *
 * This is the backup mechanism, the migration path off the app, and what makes
 * depending on a free tier acceptable — the data is never hostage to a pricing
 * decision. It runs entirely client-side against IndexedDB; no server needed.
 *
 * What's included: everything the user owns or authored — profile, custom
 * exercises, templates, logged workouts, and body metrics. What's excluded: the
 * system exercise/muscle library (re-seeded on any device) and sync bookkeeping
 * (outbox, dead-letter, cursors), which are machine-local and meaningless to
 * move.
 *
 * Import is **additive by key**: rows are `bulkPut` on their client-generated
 * ids, so re-importing the same file is idempotent and importing onto an
 * existing library merges rather than duplicating. It does not delete anything
 * the file omits.
 */

import { db } from '@/db/database'
import { getActiveUserId } from '@/db/seed'
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
  /** Format marker + version, so an importer can validate before touching data. */
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

/** A one-line count summary, for the confirm dialog and the post-import toast. */
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

/**
 * Gather everything the user owns into a serializable object. Filters out
 * soft-deleted rows so a backup is a clean snapshot, not a tombstone archive.
 */
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

/** Serialize a backup to a pretty-printed JSON string for download. */
export async function exportToJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2)
}

/** A filename with a sortable date stamp, e.g. `fitnote-backup-2026-08-07.json`. */
export function backupFilename(isoDate: string): string {
  return `fitnote-backup-${isoDate}.json`
}

export class BackupParseError extends Error {}

/**
 * Validate and parse a JSON string into a BackupFile, or throw BackupParseError
 * with a human-readable reason. Deliberately strict about the envelope but
 * lenient about extra fields, so a newer minor version still imports.
 */
export function parseBackup(json: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new BackupParseError("That file isn't valid JSON.")
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupParseError('That file is not a FitNote backup.')
  }
  const obj = parsed as Record<string, unknown>
  if (obj.format !== 'fitnote-backup') {
    throw new BackupParseError('That file is not a FitNote backup.')
  }
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new BackupParseError(
      'This backup was made by a newer version of FitNote. Update the app, then import.',
    )
  }
  if (typeof obj.data !== 'object' || obj.data === null) {
    throw new BackupParseError('This backup is missing its data.')
  }

  // Normalize: tolerate a file that predates a table by defaulting it to empty.
  const d = obj.data as Record<string, unknown>
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    format: 'fitnote-backup',
    version: obj.version,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    data: {
      profile: (d.profile as Profile) ?? null,
      exercises: arr<Exercise>(d.exercises),
      templates: arr<Template>(d.templates),
      templateExercises: arr<TemplateExercise>(d.templateExercises),
      workouts: arr<Workout>(d.workouts),
      workoutExercises: arr<WorkoutExercise>(d.workoutExercises),
      sets: arr<WorkoutSet>(d.sets),
      personalRecords: arr<PersonalRecord>(d.personalRecords),
      metricEntries: arr<MetricEntry>(d.metricEntries),
    },
  }
}

/**
 * Restore a parsed backup into IndexedDB, merging by id (bulkPut).
 *
 * Rows are re-stamped to the *current* active user so an export from an offline
 * account imports cleanly under a signed-in one (and vice versa) — the id RLS
 * checks is the owner, and a foreign owner id would make the rows invisible.
 * Ids themselves are preserved, so the workout→exercise→set graph stays intact.
 *
 * The whole restore is one transaction: a malformed row fails the import rather
 * than leaving a half-written graph.
 */
export async function importBackup(file: BackupFile): Promise<BackupCounts> {
  const userId = getActiveUserId()

  await db.transaction(
    'rw',
    [
      db.profiles,
      db.exercises,
      db.templates,
      db.templateExercises,
      db.workouts,
      db.workoutExercises,
      db.sets,
      db.personalRecords,
      db.metricEntries,
    ],
    async () => {
      const { data } = file

      if (data.profile) {
        // Keep the local id/units; only merge the imported display fields would
        // be surprising, so restore the profile wholesale but under this user id.
        await db.profiles.put({ ...data.profile, id: userId })
      }

      // Re-own every user-scoped row. The system library (userId null) is never
      // in the file, so custom exercises are safe to stamp with the active id.
      await db.exercises.bulkPut(data.exercises.map((e) => ({ ...e, userId })))
      await db.templates.bulkPut(data.templates.map((t) => ({ ...t, userId })))
      await db.templateExercises.bulkPut(data.templateExercises)
      await db.workouts.bulkPut(data.workouts.map((w) => ({ ...w, userId })))
      await db.workoutExercises.bulkPut(data.workoutExercises)
      await db.sets.bulkPut(data.sets)
      await db.personalRecords.bulkPut(data.personalRecords)
      await db.metricEntries.bulkPut(data.metricEntries.map((m) => ({ ...m, userId })))
    },
  )

  return countsOf(file)
}
