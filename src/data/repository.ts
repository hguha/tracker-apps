/**
 * The one data-access boundary (§5.6). No component imports Dexie directly, so
 * attaching Supabase later means adding a sync drain behind this module rather
 * than touching every screen.
 *
 * Two invariants every mutation here upholds:
 *   1. Ids are generated client-side, so a replayed write is an upsert on a
 *      known key rather than a duplicate row.
 *   2. Every write also appends to the outbox, so the queue is already correct
 *      when a server exists to drain it to.
 */

import { db, syncStamp, touch, type OutboxEntry } from '@/db/database'
import { getActiveUserId, LOCAL_USER_ID } from '@/db/seed'
import { formatDistance, formatWeight, weightToKg } from '@/lib/units'
import {
  bestOneRepMaxKg,
  estimatedOneRepMaxKg,
  isWorkingSet,
  volumeLoadKg,
} from '@/lib/metrics'
import { nextTarget } from '@/lib/progression'
import { weekStart } from '@/lib/dates'
import {
  buildCoachSummary,
  SUMMARY_WEEKS,
  type CoachSummary,
  type SummarySession,
} from '@/features/coach/summary'
import { sessionTitle, type SetSignal } from '@/lib/sessionTitle'
import type {
  DistanceUnit,
  Exercise,
  LastPerformance,
  Region,
  MetricEntry,
  PerformedSession,
  PersonalRecord,
  Profile,
  RecordType,
  Template,
  TemplateExercise,
  WeightUnit,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/domain/types'

export function newId(): string {
  return crypto.randomUUID()
}

async function enqueue(
  table: string,
  op: OutboxEntry['op'],
  rowId: string,
  payload: object,
  clientRev: number,
): Promise<void> {
  await db.outbox.add({
    table,
    op,
    rowId,
    payload,
    clientRev,
    queuedAt: Date.now(),
    attempts: 0,
  })
}

/** The sync columns every user-owned row carries (§4.11). */
type SyncFields = {
  updatedAt: number
  deletedAt: number | null
  clientRev: number
}

/** A Dexie table of rows carrying the sync columns, keyed by a string id. */
type SyncedStore<T extends SyncFields> = {
  get: (id: string) => Promise<T | undefined>
  update: (id: string, changes: Partial<T>) => Promise<number>
}

/**
 * The one place a row is patched, stamped, and enqueued.
 *
 * Every field edit, soft-delete, and restore in this module funnels through here
 * — previously ~17 functions repeated the same read/touch/update/enqueue block,
 * which meant the `clientRev + 1` sent to the outbox had to stay in lockstep with
 * `touch()` by hand in every copy. One helper removes that whole class of drift.
 * A missing row is a no-op (a deleted row can't be patched), matching the old
 * behavior.
 */
async function patchRow<T extends SyncFields>(
  store: SyncedStore<T>,
  table: string,
  id: string,
  patch: Partial<T>,
): Promise<void> {
  const current = await store.get(id)
  if (!current) return
  const next = { ...patch, ...touch(current.clientRev) } as Partial<T>
  await store.update(id, next)
  // Enqueue the FULL row, not just the changed fields.
  //
  // The push is an upsert, which PostgREST issues as
  // `INSERT ... ON CONFLICT (id) DO UPDATE`. Postgres evaluates the INSERT
  // policy's WITH CHECK against the *proposed* tuple — so a partial payload
  // arrives with `user_id` absent (NULL), `user_id = auth.uid()` is false, and
  // the write is rejected with "new row violates row-level security policy".
  // That failed for every update, not just for rows the server hadn't seen:
  // chained tables broke identically, since a missing `workout_id` makes their
  // ownership walk fail too. Sending the whole row keeps the upsert valid under
  // RLS and stays idempotent (same id, last-write-wins on clientRev).
  await enqueue(table, 'update', id, { ...current, ...next }, current.clientRev + 1)
}

// ------------------------------------------------------------------ profile

export async function getProfile(): Promise<Profile> {
  const profile = await db.profiles.get(getActiveUserId())
  if (!profile) throw new Error('Profile missing — seeding did not run')
  return profile
}

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  await patchRow(db.profiles, 'profiles', getActiveUserId(), patch)
}

/**
 * Claim the on-device ("this device only") data into a real account (§11.1.3).
 *
 * A device-only account owns its rows under `LOCAL_USER_ID` ('local-user'). When
 * that user signs in for real, their history must move with them — otherwise the
 * signed-in account starts empty and every local row is stranded (and, worse,
 * silently rejected by the server's RLS because its `user_id` is 'local-user',
 * not the caller's uid — the "failed to sync" flood).
 *
 * This re-owns everything to the new uid and re-enqueues it so the next drain
 * pushes it under the correct identity:
 *   - The profile row is keyed by user id, so it's *copied* to a new row keyed by
 *     the uid (merging onto the account's server-seeded profile if one exists).
 *   - `userId`-bearing rows (workouts, templates, metric entries, and any custom
 *     library rows) are re-stamped to the uid.
 *   - Chained-ownership rows (workout_exercises, sets, template_exercises) carry
 *     no userId — they follow their parent — but still need re-enqueuing so the
 *     server receives them.
 *
 * Idempotent and safe to no-op: if there's nothing under 'local-user', it does
 * nothing. Runs in one transaction so a crash can't half-migrate ownership.
 */
export async function claimLocalData(newUserId: string): Promise<number> {
  if (newUserId === LOCAL_USER_ID) return 0

  // Tables that carry a `userId` we must re-stamp. Custom library rows
  // (muscles/exercises/metricDefinitions) have `userId: string | null` — only
  // the user-owned ones (non-null, === local) move; system rows (null) stay.
  const owned = [
    { table: 'workouts', store: db.workouts },
    { table: 'templates', store: db.templates },
    { table: 'metricEntries', store: db.metricEntries },
    { table: 'muscles', store: db.muscles },
    { table: 'exercises', store: db.exercises },
    { table: 'metricDefinitions', store: db.metricDefinitions },
  ] as const

  // Chained-ownership tables: no userId, but their rows still must be pushed
  // under the new identity. We re-enqueue every live row that belongs to a
  // claimed parent. Simpler and correct: re-enqueue all live rows (the server
  // upserts idempotently, and RLS accepts them once the parent is owned).
  const chained = [
    { table: 'workoutExercises', store: db.workoutExercises },
    { table: 'sets', store: db.sets },
    { table: 'templateExercises', store: db.templateExercises },
  ] as const

  let claimed = 0
  const now = Date.now()

  await db.transaction(
    'rw',
    [
      db.profiles,
      db.workouts,
      db.templates,
      db.metricEntries,
      db.muscles,
      db.exercises,
      db.metricDefinitions,
      db.workoutExercises,
      db.sets,
      db.templateExercises,
      db.outbox,
    ],
    async () => {
      // 1. Profile: copy the local row onto a row keyed by the new uid. Prefer an
      //    already-present account profile's identity fields, but carry over the
      //    local settings the user has been using on this device.
      const localProfile = await db.profiles.get(LOCAL_USER_ID)
      if (localProfile) {
        const existing = await db.profiles.get(newUserId)
        const merged: Profile = {
          ...localProfile,
          ...(existing ?? {}),
          // Local preferences win — they're what the user set up on this device.
          unitWeight: localProfile.unitWeight,
          unitDistance: localProfile.unitDistance,
          unitLength: localProfile.unitLength,
          weekStartsOn: localProfile.weekStartsOn,
          weeklyWorkoutGoal: localProfile.weeklyWorkoutGoal,
          defaultRestSeconds: localProfile.defaultRestSeconds,
          showRpe: localProfile.showRpe,
          showAvatar: localProfile.showAvatar,
          autoStartRest: localProfile.autoStartRest,
          soundEnabled: localProfile.soundEnabled,
          theme: localProfile.theme,
          colorScheme: localProfile.colorScheme,
          accentOverride: localProfile.accentOverride,
          bodyweightCacheKg: localProfile.bodyweightCacheKg,
          heightCm: localProfile.heightCm ?? null,
          trainingGoal: localProfile.trainingGoal ?? '',
          id: newUserId,
          updatedAt: now,
          deletedAt: null,
          clientRev: (existing?.clientRev ?? localProfile.clientRev) + 1,
        }
        await db.profiles.put(merged)
        await db.profiles.delete(LOCAL_USER_ID)
        await enqueue('profiles', 'update', newUserId, merged, merged.clientRev)
        claimed += 1
      }

      // 2. Re-stamp userId-bearing rows owned by the local account.
      for (const { table, store } of owned) {
        const rows = await (store as typeof db.workouts).toArray()
        for (const row of rows) {
          if ((row as { userId: string | null }).userId !== LOCAL_USER_ID) continue
          const next = {
            ...row,
            userId: newUserId,
            updatedAt: now,
            clientRev: row.clientRev + 1,
          }
          await (store as typeof db.workouts).put(next as Workout)
          await enqueue(table, 'update', row.id, next, next.clientRev)
          claimed += 1
        }
      }

      // 3. Re-enqueue chained rows so the server receives them under the new
      //    identity. They aren't re-stamped (no userId) but their clientRev is
      //    bumped so the push is a fresh upsert the server will accept.
      for (const { table, store } of chained) {
        const rows = await (store as typeof db.sets).toArray()
        for (const row of rows) {
          if (row.deletedAt !== null) continue
          const next = { ...row, updatedAt: now, clientRev: row.clientRev + 1 }
          await (store as typeof db.sets).put(next)
          await enqueue(table, 'update', row.id, next, next.clientRev)
          claimed += 1
        }
      }
    },
  )

  return claimed
}

// ---------------------------------------------------------------- exercises

export async function listExercises(): Promise<Exercise[]> {
  const all = await db.exercises.toArray()
  return all
    .filter((e) => e.deletedAt === null && !e.isArchived)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id)
}

export interface NewExerciseInput {
  name: string
  primaryMuscleId: string
  equipment: Exercise['equipment']
  movementPattern: Exercise['movementPattern']
  trackingType: Exercise['trackingType']
  secondaryMuscles?: { muscleId: string; contribution: number }[]
  isUnilateral?: boolean
  bodyweightFactor?: number | null
  notes?: string
  defaultRestSeconds?: number | null
}

export async function createExercise(input: NewExerciseInput): Promise<string> {
  const exercise: Exercise = {
    id: newId(),
    userId: getActiveUserId(),
    name: input.name.trim(),
    primaryMuscleId: input.primaryMuscleId,
    secondaryMuscles: input.secondaryMuscles ?? [],
    aliases: [],
    equipment: input.equipment,
    movementPattern: input.movementPattern,
    trackingType: input.trackingType,
    isUnilateral: input.isUnilateral ?? false,
    bodyweightFactor: input.bodyweightFactor ?? null,
    isKeyLift: false,
    notes: input.notes ?? '',
    defaultRestSeconds: input.defaultRestSeconds ?? null,
    isArchived: false,
    ...syncStamp(),
  }
  await db.exercises.add(exercise)
  await enqueue('exercises', 'insert', exercise.id, exercise, exercise.clientRev)
  return exercise.id
}

export async function updateExercise(
  id: string,
  patch: Partial<Exercise>,
): Promise<void> {
  await patchRow(db.exercises, 'exercises', id, patch)
}

/**
 * Everything the library detail screen shows for one exercise (§7.3):
 * taxonomy, records, and every session it appears in.
 */
export interface ExerciseDetail {
  exercise: Exercise
  primaryMuscle: { id: string; name: string; region: string } | undefined
  secondaryMuscles: { id: string; name: string; region: string; contribution: number }[]
  records: PersonalRecord[]
  sessions: {
    workoutId: string
    performedAt: number
    sets: WorkoutSet[]
    volumeKg: number
    bestE1rmKg: number | null
  }[]
  lastTrainedAt: number | null
}

export async function getExerciseDetail(
  exerciseId: string,
): Promise<ExerciseDetail | null> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return null

  const primary = await db.muscles.get(exercise.primaryMuscleId)
  const secondaries = await Promise.all(
    (exercise.secondaryMuscles ?? []).map(async (s) => {
      const muscle = await db.muscles.get(s.muscleId)
      return muscle
        ? {
            id: muscle.id,
            name: muscle.name,
            region: muscle.region as string,
            contribution: s.contribution,
          }
        : null
    }),
  )

  const workoutExercises = (
    await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()
  ).filter((we) => we.deletedAt === null)

  const sessions: ExerciseDetail['sessions'] = []
  for (const we of workoutExercises) {
    const workout = await db.workouts.get(we.workoutId)
    if (!workout || workout.deletedAt !== null) continue
    const sets = (await listSets(we.id)).filter((s) => s.isCompleted)
    if (sets.length === 0) continue
    sessions.push({
      workoutId: workout.id,
      performedAt: workout.startedAt,
      sets,
      volumeKg: volumeLoadKg(sets, exercise, workout.bodyweightKg),
      bestE1rmKg: bestOneRepMaxKg(sets),
    })
  }
  sessions.sort((a, b) => b.performedAt - a.performedAt)

  return {
    exercise,
    primaryMuscle: primary
      ? { id: primary.id, name: primary.name, region: primary.region as string }
      : undefined,
    secondaryMuscles: secondaries.filter((s): s is NonNullable<typeof s> => s !== null),
    records: await listPersonalRecords(exerciseId),
    sessions,
    lastTrainedAt: sessions[0]?.performedAt ?? null,
  }
}

/**
 * When each exercise was last trained. Used to rank search results and to show
 * "last trained" in the library list.
 */
export async function getLastTrainedMap(): Promise<Map<string, number>> {
  const recent = (
    await db.workouts.orderBy('startedAt').reverse().limit(200).toArray()
  ).filter((w) => w.deletedAt === null)
  const startedAtById = new Map(recent.map((w) => [w.id, w.startedAt]))
  if (startedAtById.size === 0) return new Map()

  // One indexed range read for every exercise row across the recent window,
  // rather than a sequential listWorkoutExercises per workout.
  const rows = await db.workoutExercises
    .where('workoutId')
    .anyOf([...startedAtById.keys()])
    .toArray()

  const lastTrained = new Map<string, number>()
  for (const we of rows) {
    if (we.deletedAt !== null) continue
    const startedAt = startedAtById.get(we.workoutId)
    if (startedAt === undefined) continue
    // Keep the most recent sighting per exercise.
    const existing = lastTrained.get(we.exerciseId)
    if (existing === undefined || startedAt > existing) {
      lastTrained.set(we.exerciseId, startedAt)
    }
  }
  return lastTrained
}

/**
 * Copies a system exercise into a user-owned one so its taxonomy can be edited.
 * System rows are shared, so they're read-only; this is the escape hatch.
 */
export async function duplicateExercise(exerciseId: string): Promise<string | null> {
  const source = await db.exercises.get(exerciseId)
  if (!source) return null
  return createExercise({
    name: `${source.name} (custom)`,
    primaryMuscleId: source.primaryMuscleId,
    equipment: source.equipment,
    movementPattern: source.movementPattern,
    trackingType: source.trackingType,
    secondaryMuscles: source.secondaryMuscles,
    isUnilateral: source.isUnilateral,
    bodyweightFactor: source.bodyweightFactor,
    notes: source.notes,
    defaultRestSeconds: source.defaultRestSeconds,
  })
}

// ----------------------------------------------------------------- workouts

/**
 * The in-progress session, if any. At most one exists (§4.4).
 *
 * Scanned rather than indexed because IndexedDB cannot index null, and an
 * unfinished workout is what `endedAt: null` means. The scan is over the most
 * recent rows only, so it stays cheap as history grows.
 */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const recent = await db.workouts.orderBy('startedAt').reverse().limit(20).toArray()
  return recent.find((w) => w.endedAt === null && w.deletedAt === null)
}

export async function startWorkout(
  opts: {
    title?: string
    startedAt?: number
    templateId?: string | null
  } = {},
): Promise<string> {
  const profile = await getProfile()
  const workout: Workout = {
    id: newId(),
    userId: getActiveUserId(),
    startedAt: opts.startedAt ?? Date.now(),
    endedAt: null,
    title: opts.title ?? '',
    notes: '',
    perceivedExertion: null,
    templateId: opts.templateId ?? null,
    bodyweightKg: profile.bodyweightCacheKg,
    ...syncStamp(),
  }
  await db.workouts.add(workout)
  await enqueue('workouts', 'insert', workout.id, workout, workout.clientRev)
  return workout.id
}

export async function getWorkout(id: string): Promise<Workout | undefined> {
  const workout = await db.workouts.get(id)
  return workout?.deletedAt === null ? workout : undefined
}

export async function listWorkouts(limit = 100): Promise<Workout[]> {
  const all = await db.workouts.orderBy('startedAt').reverse().limit(limit).toArray()
  return all.filter((w) => w.deletedAt === null)
}

/**
 * Everything needed to render a recognizable workout row (§5.2.1).
 *
 * Rows previously showed only "Workout" plus a date, which identified nothing.
 * This bundles the derived title, the region shape, what was trained, and the
 * totals — computed once here so History, Home, and the start screen all agree.
 */
export interface WorkoutSummary {
  workout: Workout
  /** Derived per §6.7 unless the user set their own title. */
  title: string
  exerciseNames: string[]
  /** Exercise ids in this session, for filtering History by a specific lift. */
  exerciseIds: string[]
  regions: Region[]
  setCount: number
  volumeKg: number
  durationSeconds: number | null
  cardioSeconds: number
  /** Working sets per region in this session. Lets Home derive its balance bars
   *  and the avatar window from summaries already in memory, instead of a second
   *  per-workout scan of workoutExercises + sets. */
  workingSetsByRegion: Partial<Record<Region, number>>
}

export async function getWorkoutSummary(
  workout: Workout,
  regionOf?: Map<string, Region>,
): Promise<WorkoutSummary> {
  const regions = regionOf ?? (await buildRegionMap())
  const workoutExercises = await listWorkoutExercises(workout.id)
  const exercises = await db.exercises.bulkGet(
    workoutExercises.map((we) => we.exerciseId),
  )
  const exercisesById = new Map<string, Exercise>()
  exercises.forEach((ex) => ex && exercisesById.set(ex.id, ex))
  const setsByWe = new Map<string, WorkoutSet[]>()
  await Promise.all(
    workoutExercises.map(async (we) => setsByWe.set(we.id, await listSets(we.id))),
  )

  return buildWorkoutSummary(workout, workoutExercises, exercisesById, setsByWe, regions)
}

/**
 * The pure summary calculation, given everything preloaded. Kept apart from the
 * loading so the batched `listWorkoutSummaries` and the single-workout
 * `getWorkoutSummary` share one definition and can never drift.
 */
function buildWorkoutSummary(
  workout: Workout,
  workoutExercises: WorkoutExercise[],
  exercisesById: Map<string, Exercise>,
  setsByWe: Map<string, WorkoutSet[]>,
  regions: Map<string, Region>,
): WorkoutSummary {
  const exerciseNames: string[] = []
  const exerciseIds: string[] = []
  const regionSet = new Set<Region>()
  const workingSetsByRegion: Partial<Record<Region, number>> = {}
  let setCount = 0
  let volumeKg = 0
  let cardioSeconds = 0
  const signals: SetSignal[] = []

  for (const we of workoutExercises) {
    const exercise = exercisesById.get(we.exerciseId)
    if (!exercise) continue
    exerciseNames.push(exercise.name)
    exerciseIds.push(exercise.id)

    const region = regions.get(exercise.primaryMuscleId)
    if (region) regionSet.add(region)

    const logged = (setsByWe.get(we.id) ?? []).filter((s) => s.isCompleted)
    setCount += logged.length
    volumeKg += volumeLoadKg(logged, exercise, workout.bodyweightKg)

    if (exercise.movementPattern === 'cardio') {
      cardioSeconds += logged.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
    }

    if (region) {
      const workingSets = logged.filter((s) => isWorkingSet(s)).length
      if (workingSets > 0) {
        workingSetsByRegion[region] = (workingSetsByRegion[region] ?? 0) + workingSets
      }
      for (let i = 0; i < logged.length; i += 1) {
        signals.push({ region, pattern: exercise.movementPattern })
      }
    }
  }

  return {
    workout,
    title: sessionTitle(
      workout.title,
      workout.startedAt,
      signals.filter((s) => s.region !== undefined),
    ),
    exerciseNames,
    exerciseIds,
    regions: [...regionSet],
    setCount,
    volumeKg,
    durationSeconds:
      workout.endedAt !== null ? (workout.endedAt - workout.startedAt) / 1000 : null,
    cardioSeconds,
    workingSetsByRegion,
  }
}

export async function listWorkoutSummaries(limit = 100): Promise<WorkoutSummary[]> {
  const regionOf = await buildRegionMap()
  const workouts = await listWorkouts(limit)
  if (workouts.length === 0) return []

  // Load in three bulk passes rather than per-workout. The old shape did
  // 1 + (exercises × 2) sequential IndexedDB round-trips per summary, so a
  // 500-workout history opened ~6,500 queries in series; this is a handful of
  // indexed range reads regardless of history size.
  const workoutIds = workouts.map((w) => w.id)
  const allWe = (
    await db.workoutExercises.where('workoutId').anyOf(workoutIds).toArray()
  ).filter((r) => r.deletedAt === null)

  const weIds = allWe.map((we) => we.id)
  const allSets = (
    await db.sets.where('workoutExerciseId').anyOf(weIds).toArray()
  ).filter((s) => s.deletedAt === null)

  const exercises = await db.exercises.bulkGet([
    ...new Set(allWe.map((we) => we.exerciseId)),
  ])
  const exercisesById = new Map<string, Exercise>()
  exercises.forEach((ex) => ex && exercisesById.set(ex.id, ex))

  // Bucket the flat rows by their parent, sorting once, so the pure builder
  // sees the same per-workout/per-exercise shape it would from the DB.
  const weByWorkout = new Map<string, WorkoutExercise[]>()
  for (const we of allWe) {
    const list = weByWorkout.get(we.workoutId)
    if (list) list.push(we)
    else weByWorkout.set(we.workoutId, [we])
  }
  for (const list of weByWorkout.values()) list.sort((a, b) => a.position - b.position)

  const setsByWe = new Map<string, WorkoutSet[]>()
  for (const set of allSets) {
    const list = setsByWe.get(set.workoutExerciseId)
    if (list) list.push(set)
    else setsByWe.set(set.workoutExerciseId, [set])
  }
  for (const list of setsByWe.values()) list.sort((a, b) => a.position - b.position)

  return workouts.map((w) =>
    buildWorkoutSummary(
      w,
      weByWorkout.get(w.id) ?? [],
      exercisesById,
      setsByWe,
      regionOf,
    ),
  )
}

/** Slugs of the powerlifting big three, for the strength-club badges (§5.2.1). */
export const BIG_THREE = {
  squat: 'barbell_back_squat',
  bench: 'barbell_bench_press',
  deadlift: 'deadlift',
} as const

export interface BadgeStats {
  bestSquatE1rmKg: number
  bestBenchE1rmKg: number
  bestDeadliftE1rmKg: number
  bestAnyE1rmKg: number
  totalCardioMeters: number
  totalCardioSeconds: number
  distinctExercises: number
}

/**
 * Lifetime figures the Home badges need beyond what a workout summary carries:
 * best estimated 1RMs (for the strength clubs), total cardio, and exercise
 * variety. Reads the small personal-records table for e1RMs and scans cardio
 * sets in bulk — cheap, and separate from the summary path so neither bloats.
 */
export async function getBadgeStats(): Promise<BadgeStats> {
  // Best estimated 1RM per lift comes straight from the PR table. recordType
  // isn't indexed on its own (the compound index is [exerciseId+recordType]),
  // so filter in memory — the PR table is small (a few rows per lift).
  const e1rmPrs = (await db.personalRecords.toArray()).filter(
    (pr) => pr.recordType === 'max_est_1rm' && pr.deletedAt === null,
  )
  const bestE1rmByExercise = new Map<string, number>()
  let bestAnyE1rmKg = 0
  for (const pr of e1rmPrs) {
    if (pr.value > (bestE1rmByExercise.get(pr.exerciseId) ?? 0)) {
      bestE1rmByExercise.set(pr.exerciseId, pr.value)
    }
    if (pr.value > bestAnyE1rmKg) bestAnyE1rmKg = pr.value
  }

  // Cardio totals and exercise variety: one bulk scan of completed sets, joined
  // to their exercise's movement pattern.
  const workouts = await listWorkouts(1000)
  const workoutIds = workouts.map((w) => w.id)
  const allWe = (
    await db.workoutExercises.where('workoutId').anyOf(workoutIds).toArray()
  ).filter((r) => r.deletedAt === null)
  const exercises = await db.exercises.bulkGet([
    ...new Set(allWe.map((we) => we.exerciseId)),
  ])
  const patternByExercise = new Map<string, string>()
  exercises.forEach((ex) => ex && patternByExercise.set(ex.id, ex.movementPattern))
  const weToExercise = new Map(allWe.map((we) => [we.id, we.exerciseId]))

  const allSets = (
    await db.sets
      .where('workoutExerciseId')
      .anyOf(allWe.map((we) => we.id))
      .toArray()
  ).filter((s) => s.deletedAt === null && s.isCompleted)

  let totalCardioMeters = 0
  let totalCardioSeconds = 0
  const distinctExercises = new Set<string>()
  for (const set of allSets) {
    const exerciseId = weToExercise.get(set.workoutExerciseId)
    if (!exerciseId) continue
    distinctExercises.add(exerciseId)
    if (patternByExercise.get(exerciseId) === 'cardio') {
      totalCardioMeters += set.distanceM ?? 0
      totalCardioSeconds += set.durationSeconds ?? 0
    }
  }

  return {
    bestSquatE1rmKg: bestE1rmByExercise.get(BIG_THREE.squat) ?? 0,
    bestBenchE1rmKg: bestE1rmByExercise.get(BIG_THREE.bench) ?? 0,
    bestDeadliftE1rmKg: bestE1rmByExercise.get(BIG_THREE.deadlift) ?? 0,
    bestAnyE1rmKg,
    totalCardioMeters,
    totalCardioSeconds,
    distinctExercises: distinctExercises.size,
  }
}

/**
 * Assemble the de-identified training summary for the AI coach (§13).
 *
 * Loads the last SUMMARY_WEEKS of completed sessions in bulk, reduces each to
 * the shape `buildCoachSummary` needs (taxonomy + sets, dates as week offsets),
 * and returns the aggregate. This is the *only* function that feeds the coach —
 * the privacy contract lives in `buildCoachSummary`, which never sees a name,
 * note, or absolute date.
 */
export async function getCoachSummary(): Promise<CoachSummary> {
  const profile = await getProfile()
  const regionOf = await buildRegionMap()

  const cutoff = Date.now() - SUMMARY_WEEKS * 7 * 24 * 3600 * 1000
  const thisWeekStart = weekStart(Date.now(), profile.weekStartsOn)
  const workouts = (await listWorkouts(1000)).filter(
    (w) => w.endedAt !== null && w.startedAt >= cutoff,
  )

  if (workouts.length === 0) {
    return buildCoachSummary({
      unitWeight: profile.unitWeight,
      unitLength: profile.unitLength,
      weeklyWorkoutGoal: profile.weeklyWorkoutGoal || 4,
      bodyweightKg: profile.bodyweightCacheKg,
      heightCm: profile.heightCm ?? null,
      trainingGoal: profile.trainingGoal ?? '',
      sessions: [],
    })
  }

  // Bulk-load exercises and sets for the window (same shape as summaries).
  const allWe = (
    await db.workoutExercises
      .where('workoutId')
      .anyOf(workouts.map((w) => w.id))
      .toArray()
  ).filter((r) => r.deletedAt === null)
  const exercises = await db.exercises.bulkGet([
    ...new Set(allWe.map((we) => we.exerciseId)),
  ])
  const exercisesById = new Map<string, Exercise>()
  exercises.forEach((ex) => ex && exercisesById.set(ex.id, ex))
  const allSets = (
    await db.sets
      .where('workoutExerciseId')
      .anyOf(allWe.map((we) => we.id))
      .toArray()
  ).filter((s) => s.deletedAt === null && s.isCompleted)

  const setsByWe = new Map<string, WorkoutSet[]>()
  for (const s of allSets) {
    const list = setsByWe.get(s.workoutExerciseId)
    if (list) list.push(s)
    else setsByWe.set(s.workoutExerciseId, [s])
  }
  const weByWorkout = new Map<string, WorkoutExercise[]>()
  for (const we of allWe) {
    const list = weByWorkout.get(we.workoutId)
    if (list) list.push(we)
    else weByWorkout.set(we.workoutId, [we])
  }

  const WEEK_MS = 7 * 24 * 3600 * 1000
  const sessions: SummarySession[] = workouts.map((w) => {
    // Whole-week offset from the current week; 0 = this week, negative = past.
    const weekOffset = Math.round(
      (weekStart(w.startedAt, profile.weekStartsOn) - thisWeekStart) / WEEK_MS,
    )
    const exerciseInstances = (weByWorkout.get(w.id) ?? [])
      .map((we) => {
        const exercise = exercisesById.get(we.exerciseId)
        if (!exercise) return null
        return {
          exerciseId: exercise.id,
          name: exercise.name,
          region: regionOf.get(exercise.primaryMuscleId),
          pattern: exercise.movementPattern,
          equipment: exercise.equipment,
          isCardio: exercise.movementPattern === 'cardio',
          sets: (setsByWe.get(we.id) ?? []).map((s) => ({
            weightKg: s.weightKg,
            reps: s.reps,
            rpe: s.rpe,
            durationSeconds: s.durationSeconds,
            distanceM: s.distanceM,
          })),
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
    return { weekOffset, exercises: exerciseInstances }
  })

  return buildCoachSummary({
    unitWeight: profile.unitWeight,
    unitLength: profile.unitLength,
    weeklyWorkoutGoal: profile.weeklyWorkoutGoal || 4,
    bodyweightKg: profile.bodyweightCacheKg,
    heightCm: profile.heightCm ?? null,
    trainingGoal: profile.trainingGoal ?? '',
    sessions,
  })
}

/**
 * A read-only outline of what a session (or template) contains, for the
 * preview shown before committing to start a copy (§7.2, §7.4). Lets the user
 * confirm they're about to start the right workout instead of starting it on
 * the first tap.
 */
export interface WorkoutPreview {
  title: string
  performedAt: number | null
  exercises: {
    name: string
    region: Region | undefined
    /** e.g. "3 × 8 @ 60kg" for lifting, "27:30 · 3.1mi" for cardio. */
    detail: string
    setCount: number
  }[]
  totalSets: number
}

export async function getWorkoutPreview(
  workoutId: string,
): Promise<WorkoutPreview | null> {
  const workout = await getWorkout(workoutId)
  if (!workout) return null
  const profile = await getProfile()
  const regionOf = await buildRegionMap()
  const workoutExercises = await listWorkoutExercises(workoutId)
  const signals: SetSignal[] = []

  const exercises: WorkoutPreview['exercises'] = []
  let totalSets = 0

  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId)
    if (!exercise) continue
    const region = regionOf.get(exercise.primaryMuscleId)
    const logged = (await listSets(we.id)).filter((s) => s.isCompleted)
    totalSets += logged.length
    if (region) {
      for (let i = 0; i < logged.length; i += 1) {
        signals.push({ region, pattern: exercise.movementPattern })
      }
    }
    exercises.push({
      name: exercise.name,
      region,
      detail: summarizeSets(logged, profile.unitWeight, profile.unitDistance),
      setCount: logged.length,
    })
  }

  return {
    title: sessionTitle(workout.title, workout.startedAt, signals),
    performedAt: workout.startedAt,
    exercises,
    totalSets,
  }
}

/**
 * A compact one-line summary of a group of sets, for the preview.
 * Weights and distances are shown in the user's units (§4.12) — the preview is a
 * display surface, so it converts out of canonical storage like every other one.
 */
function summarizeSets(
  sets: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>[],
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  const working = sets
  if (working.length === 0) return 'no sets'

  const first = working[0]!
  // Cardio-shaped: duration and optional distance.
  if (first.durationSeconds !== null) {
    const seconds = working.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
    const meters = working.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)
    const mins = Math.round(seconds / 60)
    return meters > 0
      ? `${mins} min · ${formatDistance(meters, distanceUnit)}`
      : `${mins} min`
  }

  const reps = working.map((s) => s.reps).filter((r): r is number => r !== null)
  const weights = working.map((s) => s.weightKg).filter((w): w is number => w !== null)
  const repPart =
    reps.length === 0
      ? ''
      : Math.min(...reps) === Math.max(...reps)
        ? ` × ${reps[0]}`
        : ` × ${Math.min(...reps)}-${Math.max(...reps)}`
  const weightPart =
    weights.length > 0 ? ` @ ${formatWeight(Math.max(...weights), weightUnit)}` : ''
  return `${working.length} sets${repPart}${weightPart}`
}

async function buildRegionMap(): Promise<Map<string, Region>> {
  const muscles = await db.muscles.toArray()
  return new Map(muscles.map((m) => [m.id, m.region]))
}

export async function updateWorkout(id: string, patch: Partial<Workout>): Promise<void> {
  await patchRow(db.workouts, 'workouts', id, patch)
}

/**
 * Ends a session, or discards it if nothing was logged (§6.4.1).
 *
 * Returns what happened, so the UI can say so. An empty workout is not a record
 * of anything — saving one breaks streaks, dilutes averages, and leaves a row the
 * user can't identify.
 */
export async function finishWorkout(id: string): Promise<'saved' | 'discarded-empty'> {
  await discardEmptySets(id)

  if (!(await hasLoggedWork(id))) {
    await deleteWorkout(id)
    await db.placeholderOverrides.delete(id)
    return 'discarded-empty'
  }

  await updateWorkout(id, { endedAt: Date.now() })
  await rebuildLastPerformanceForWorkout(id)
  // Placeholder hints are per-repeat and meaningless once the session is done.
  await db.placeholderOverrides.delete(id)
  return 'saved'
}

/** Whether a session has any completed set (§6.4.1 — empty workouts discard). */
export async function hasLoggedWork(workoutId: string): Promise<boolean> {
  for (const we of await listWorkoutExercises(workoutId)) {
    const sets = await listSets(we.id)
    if (sets.some((s) => s.isCompleted)) return true
  }
  return false
}

/**
 * Removes placeholder rows that were never filled in (§6.2).
 *
 * Called on finish so an unfinished template checklist doesn't leave empty sets
 * in history. They're soft-deleted like anything else, so the removal syncs.
 */
export async function discardEmptySets(workoutId: string): Promise<number> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  let discarded = 0

  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId)
    if (!exercise) continue
    for (const set of await listSets(we.id)) {
      if (!setHasValues(set, exercise)) {
        await deleteSet(set.id)
        discarded += 1
      }
    }
  }

  // An exercise left with no sets at all was never actually trained.
  for (const we of workoutExercises) {
    if ((await listSets(we.id)).length === 0) {
      await removeWorkoutExercise(we.id)
    }
  }

  return discarded
}

export async function deleteWorkout(id: string): Promise<void> {
  // Soft delete only — a hard delete can't be represented in pull-based sync.
  await patchRow(db.workouts, 'workouts', id, { deletedAt: Date.now() })
  // A discarded workout's sets no longer count toward records.
  await rebuildLastPerformanceForWorkout(id)
}

/** Backs the undo on a discarded workout. */
export async function restoreWorkout(id: string): Promise<void> {
  await patchRow(db.workouts, 'workouts', id, { deletedAt: null })
  await rebuildLastPerformanceForWorkout(id)
}

// -------------------------------------------------------- workout exercises

export async function listWorkoutExercises(
  workoutId: string,
): Promise<WorkoutExercise[]> {
  const rows = await db.workoutExercises.where('workoutId').equals(workoutId).toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.position - b.position)
}

export async function addExerciseToWorkout(
  workoutId: string,
  exerciseId: string,
): Promise<string> {
  const existing = await listWorkoutExercises(workoutId)
  const row: WorkoutExercise = {
    id: newId(),
    workoutId,
    exerciseId,
    position: existing.length,
    supersetGroup: null,
    restSeconds: null,
    notes: '',
    ...syncStamp(),
  }
  await db.workoutExercises.add(row)
  await enqueue('workoutExercises', 'insert', row.id, row, row.clientRev)
  return row.id
}

export async function updateWorkoutExercise(
  id: string,
  patch: Partial<WorkoutExercise>,
): Promise<void> {
  await patchRow(db.workoutExercises, 'workoutExercises', id, patch)
}

export async function removeWorkoutExercise(id: string): Promise<void> {
  await patchRow(db.workoutExercises, 'workoutExercises', id, { deletedAt: Date.now() })
}

/** Restores a swipe-deleted exercise. Backs the undo toast (§6.4). */
export async function restoreWorkoutExercise(id: string): Promise<void> {
  await patchRow(db.workoutExercises, 'workoutExercises', id, { deletedAt: null })
}

/** Applies a new order after a drag (§6.4). */
export async function reorderWorkoutExercises(orderedIds: string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await updateWorkoutExercise(id, { position: index })
  }
}

/** Groups exercises into a superset, or ungroups them by passing null. */
export async function setSupersetGroup(
  ids: string[],
  group: number | null,
): Promise<void> {
  for (const id of ids) {
    await updateWorkoutExercise(id, { supersetGroup: group })
  }
}

/**
 * Supersets two exercises by dropping one onto the other (§6.4).
 *
 * If either is already in a group, both join that group rather than starting a
 * new one — dragging a third exercise onto a existing pair extends it to three.
 * The dragged exercise also moves adjacent to its partner, since a superset that
 * isn't contiguous in the list reads as a mistake.
 */
export async function supersetExercises(
  draggedId: string,
  targetId: string,
): Promise<void> {
  if (draggedId === targetId) return

  const dragged = await db.workoutExercises.get(draggedId)
  const target = await db.workoutExercises.get(targetId)
  if (!dragged || !target) return

  const siblings = await listWorkoutExercises(dragged.workoutId)
  const existingGroup = target.supersetGroup ?? dragged.supersetGroup
  const group =
    existingGroup ?? Math.max(0, ...siblings.map((s) => s.supersetGroup ?? 0)) + 1

  await updateWorkoutExercise(draggedId, { supersetGroup: group })
  await updateWorkoutExercise(targetId, { supersetGroup: group })

  // Move the dragged card to sit directly after its partner.
  const withoutDragged = siblings.filter((s) => s.id !== draggedId)
  const targetIndex = withoutDragged.findIndex((s) => s.id === targetId)
  const reordered = [
    ...withoutDragged.slice(0, targetIndex + 1),
    dragged,
    ...withoutDragged.slice(targetIndex + 1),
  ]
  await reorderWorkoutExercises(reordered.map((s) => s.id))
}

/** Removes an exercise from its superset. Ungroups the partner if left alone. */
export async function removeFromSuperset(workoutExerciseId: string): Promise<void> {
  const row = await db.workoutExercises.get(workoutExerciseId)
  if (!row || row.supersetGroup === null) return

  const group = row.supersetGroup
  await updateWorkoutExercise(workoutExerciseId, { supersetGroup: null })

  const remaining = (await listWorkoutExercises(row.workoutId)).filter(
    (s) => s.supersetGroup === group,
  )
  // A "superset" of one is just an exercise.
  if (remaining.length === 1) {
    await updateWorkoutExercise(remaining[0]!.id, { supersetGroup: null })
  }
}

/**
 * The signals `lib/sessionTitle.ts` needs to derive a title (§6.7) — one entry
 * per working set, carrying the region and pattern that produced it.
 */
export async function getSessionTitleSignals(workoutId: string): Promise<SetSignal[]> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  const signals: SetSignal[] = []

  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId)
    if (!exercise) continue
    const muscle = await db.muscles.get(exercise.primaryMuscleId)
    if (!muscle) continue

    const working = (await listSets(we.id)).filter((s) => s.isCompleted)
    for (let i = 0; i < working.length; i += 1) {
      signals.push({ region: muscle.region, pattern: exercise.movementPattern })
    }
  }

  return signals
}

// --------------------------------------------------------------------- sets

export async function listSets(workoutExerciseId: string): Promise<WorkoutSet[]> {
  const rows = await db.sets
    .where('workoutExerciseId')
    .equals(workoutExerciseId)
    .toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.position - b.position)
}

export async function listSetsForWorkout(workoutId: string): Promise<WorkoutSet[]> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  const perExercise = await Promise.all(workoutExercises.map((we) => listSets(we.id)))
  return perExercise.flat()
}

export interface NewSetInput {
  workoutExerciseId: string
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
  distanceM?: number | null
  isCompleted?: boolean
  enteredUnit?: WeightUnit | null
  /** Insert directly after this set instead of at the end (duplicate a set). */
  afterPosition?: number
}

export async function addSet(input: NewSetInput): Promise<string> {
  const siblings = await listSets(input.workoutExerciseId)

  let position: number
  if (input.afterPosition === undefined) {
    position = siblings.length
  } else {
    position = input.afterPosition + 1
    // Shift everything after the insertion point down by one.
    for (const sibling of siblings) {
      if (sibling.position >= position) {
        await updateSet(sibling.id, { position: sibling.position + 1 })
      }
    }
  }

  const set: WorkoutSet = {
    id: newId(),
    workoutExerciseId: input.workoutExerciseId,
    position,
    setType: 'normal',
    weightKg: input.weightKg ?? null,
    reps: input.reps ?? null,
    repsLeft: null,
    repsRight: null,
    durationSeconds: input.durationSeconds ?? null,
    distanceM: input.distanceM ?? null,
    rpe: null,
    rir: null,
    restTakenSeconds: null,
    isCompleted: input.isCompleted ?? false,
    completedAt: input.isCompleted ? Date.now() : null,
    notes: '',
    enteredUnit: input.enteredUnit ?? null,
    ...syncStamp(),
  }
  await db.sets.add(set)
  await enqueue('sets', 'insert', set.id, set, set.clientRev)
  return set.id
}

export async function updateSet(id: string, patch: Partial<WorkoutSet>): Promise<void> {
  await patchRow(db.sets, 'sets', id, patch)
}

export async function deleteSet(id: string): Promise<void> {
  await patchRow(db.sets, 'sets', id, { deletedAt: Date.now() })
}

export async function restoreSet(id: string): Promise<void> {
  await patchRow(db.sets, 'sets', id, { deletedAt: null })
}

/**
 * Writes values to a set and derives its completion (§6.2).
 *
 * There is no separate confirm step: a set with values is performed, a set
 * without them is a placeholder. Returns any records the new values just broke,
 * computed locally so feedback lands in the same frame as the keystroke.
 */
export async function logSetValues(
  id: string,
  values: Partial<WorkoutSet>,
): Promise<RecordType[]> {
  const current = await db.sets.get(id)
  if (!current) return []
  const workoutExercise = await db.workoutExercises.get(current.workoutExerciseId)
  if (!workoutExercise) return []
  const exercise = await db.exercises.get(workoutExercise.exerciseId)
  if (!exercise) return []

  const merged = { ...current, ...values }
  const isCompleted = setHasValues(merged, exercise)

  await updateSet(id, {
    ...values,
    isCompleted,
    completedAt: isCompleted ? (current.completedAt ?? Date.now()) : null,
  })

  return refreshPersonalRecords(workoutExercise.exerciseId)
}

/**
 * Whether a set carries enough to count as performed. Mirrors the UI's field
 * layout per tracking type — the two must agree, or a set could look logged on
 * screen and be absent from every metric.
 */
export function setHasValues(
  set: Pick<WorkoutSet, 'reps' | 'weightKg' | 'durationSeconds' | 'distanceM'>,
  exercise: Pick<Exercise, 'trackingType'>,
): boolean {
  switch (exercise.trackingType) {
    case 'weight_reps':
    case 'weighted_bodyweight':
    case 'assisted_bodyweight':
    case 'bodyweight_reps':
    case 'reps_only':
      return set.reps !== null
    case 'time':
      return set.durationSeconds !== null
    case 'distance_time':
      return set.durationSeconds !== null || set.distanceM !== null
    case 'weight_time':
      return set.durationSeconds !== null || set.weightKg !== null
  }
}

/**
 * Copies last session's values into a set — the "same as last time" action.
 * Distinct from typing them, but lands in the same state.
 */
export async function confirmPlaceholder(setId: string): Promise<RecordType[]> {
  const set = await db.sets.get(setId)
  if (!set) return []
  const workoutExercise = await db.workoutExercises.get(set.workoutExerciseId)
  if (!workoutExercise) return []

  // A repeated session stores per-set placeholder overrides that win over
  // history (§7.2), and the row already shows them. "Same as last" must copy
  // the numbers the user is looking at, not the most-recent session's — else
  // the value logged silently contradicts the placeholder displayed.
  const overrides = await getPlaceholderOverrides(workoutExercise.workoutId)
  let prefill = overrides[setId] ?? null

  if (!prefill) {
    const siblings = await listSets(set.workoutExerciseId)
    const index = siblings.findIndex((s) => s.id === setId)
    prefill = await getPrefillForSet(workoutExercise.exerciseId, index < 0 ? 0 : index)
  }
  if (!prefill) return []

  return logSetValues(setId, {
    weightKg: prefill.weightKg,
    reps: prefill.reps,
    durationSeconds: prefill.durationSeconds,
    distanceM: prefill.distanceM,
  })
}

/**
 * Which record types the given values would beat, without writing anything.
 *
 * Powers the row glow (§6.2) — the row has to light up as the number is typed,
 * before any decision to persist has been made.
 *
 * `setId` matters more than it looks. Records are recomputed the moment a set is
 * logged, so a set that just *set* a record is then compared against its own
 * value — and `180 > 180` is false, so the row stopped glowing the instant it
 * was saved (the "toast said record but the row never went green" bug). Passing
 * the set's id excludes its own contribution, so the comparison is against the
 * best of every *other* set, which is what "is this a record" actually means.
 */
export async function previewRecords(
  exerciseId: string,
  candidate: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'> & {
    id?: string
  },
): Promise<RecordType[]> {
  const existing = await listPersonalRecords(exerciseId)
  if (existing.length === 0) return []
  const best = new Map(existing.map((pr) => [pr.recordType, pr.value]))

  // Where this set already holds the record, swap in the best of every *other*
  // set — the value the candidate actually has to beat. Dropping the entry
  // instead would leave `best` undefined, which the "nothing to beat" guard
  // below reads as "no record yet" and suppresses the glow entirely.
  const selfHeld = existing.filter(
    (pr) => candidate.id !== undefined && pr.setId === candidate.id,
  )
  if (selfHeld.length > 0) {
    const runnerUp = await bestExcludingSet(exerciseId, candidate.id!)
    for (const pr of selfHeld) {
      const other = runnerUp.get(pr.recordType)
      if (other === undefined) best.delete(pr.recordType)
      else best.set(pr.recordType, other)
    }
  }

  const broken: RecordType[] = []
  const check = (type: RecordType, value: number | null) => {
    if (value === null || !Number.isFinite(value) || value <= 0) return
    const previous = best.get(type)
    // Only a genuine improvement counts. A first-ever value never glows.
    if (previous !== undefined && value > previous) broken.push(type)
  }

  check('max_weight', candidate.weightKg)
  check('max_reps_any_weight', candidate.reps)
  check('max_est_1rm', estimatedOneRepMaxKg(candidate.weightKg, candidate.reps))
  check('max_duration', candidate.durationSeconds)
  check('max_distance', candidate.distanceM)

  return broken
}

/**
 * The best per-set value for each record type across every completed set of an
 * exercise *except* the given one — i.e. what that set has to beat.
 *
 * Only the per-set types; `max_volume_session` is a session aggregate and isn't
 * meaningful for a single row.
 */
async function bestExcludingSet(
  exerciseId: string,
  excludeSetId: string,
): Promise<Map<RecordType, number>> {
  const best = new Map<RecordType, number>()
  const consider = (type: RecordType, value: number | null) => {
    if (value === null || !Number.isFinite(value) || value <= 0) return
    const previous = best.get(type)
    if (previous === undefined || value > previous) best.set(type, value)
  }

  const workoutExercises = (
    await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()
  ).filter((we) => we.deletedAt === null)

  for (const we of workoutExercises) {
    const workout = await db.workouts.get(we.workoutId)
    if (!workout || workout.deletedAt !== null) continue
    for (const set of await listSets(we.id)) {
      if (!set.isCompleted || set.id === excludeSetId) continue
      consider('max_weight', set.weightKg)
      consider('max_reps_any_weight', set.reps)
      consider('max_est_1rm', estimatedOneRepMaxKg(set.weightKg, set.reps))
      consider('max_duration', set.durationSeconds)
      consider('max_distance', set.distanceM)
    }
  }

  return best
}

// -------------------------------------------------------- personal records

/**
 * Recomputes every record for one exercise from scratch and returns the types
 * that improved.
 *
 * Full recomputation rather than incremental comparison, because editing a past
 * workout can *invalidate* a record — a weight corrected downward has to be
 * able to remove a PR, which an incremental "is this better?" check can't do
 * (§6.6).
 */
export async function refreshPersonalRecords(exerciseId: string): Promise<RecordType[]> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return []

  const workoutExercises = (
    await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()
  ).filter((we) => we.deletedAt === null)

  const before = new Map(
    (await db.personalRecords.where('exerciseId').equals(exerciseId).toArray()).map(
      (pr) => [pr.recordType, pr.value],
    ),
  )

  const candidates = new Map<RecordType, { value: number; at: number; setId: string }>()

  function consider(type: RecordType, value: number | null, at: number, setId: string) {
    if (value === null || !Number.isFinite(value) || value <= 0) return
    const existing = candidates.get(type)
    if (!existing || value > existing.value) candidates.set(type, { value, at, setId })
  }

  for (const we of workoutExercises) {
    const workout = await db.workouts.get(we.workoutId)
    if (!workout || workout.deletedAt !== null) continue
    const sets = (await listSets(we.id)).filter((s) => s.isCompleted)
    if (sets.length === 0) continue

    const at = workout.startedAt

    for (const set of sets) {
      consider('max_weight', set.weightKg, at, set.id)
      consider('max_reps_any_weight', set.reps, at, set.id)
      consider('max_est_1rm', estimatedOneRepMaxKg(set.weightKg, set.reps), at, set.id)
      consider('max_duration', set.durationSeconds, at, set.id)
      consider('max_distance', set.distanceM, at, set.id)
    }

    const sessionVolume = volumeLoadKg(sets, exercise, workout.bodyweightKg)
    consider('max_volume_session', sessionVolume, at, sets[0]!.id)
  }

  // Replace wholesale, so a record that no longer holds disappears.
  await db.personalRecords.where('exerciseId').equals(exerciseId).delete()
  const records: PersonalRecord[] = [...candidates].map(([recordType, best]) => ({
    id: `${exerciseId}:${recordType}`,
    userId: getActiveUserId(),
    exerciseId,
    recordType,
    value: best.value,
    achievedAt: best.at,
    setId: best.setId,
    ...syncStamp(),
  }))
  if (records.length > 0) await db.personalRecords.bulkAdd(records)

  // Only report records that beat a previous one. A first-ever set technically
  // sets every record for that exercise, but calling that a PR is noise —
  // there was nothing to beat.
  return records
    .filter((pr) => {
      // `max_volume_session` is a *session* total, so it necessarily grows with
      // every set logged: set 2 beats set 1's running total, set 3 beats set 2,
      // and so on. Announcing that as a personal record fired a "New personal
      // record" toast on essentially every set of a normal workout, which is
      // both wrong and drowns out real records. It's still tracked and shown on
      // the exercise's detail sheet — it just isn't a live per-set event.
      if (pr.recordType === 'max_volume_session') return false
      const previous = before.get(pr.recordType)
      return previous !== undefined && pr.value > previous
    })
    .map((pr) => pr.recordType)
}

export async function listPersonalRecords(exerciseId: string): Promise<PersonalRecord[]> {
  return db.personalRecords.where('exerciseId').equals(exerciseId).toArray()
}

// ------------------------------------------------------- last performance

/**
 * The last-time header's data source (§6.3). A denormalized blob per exercise,
 * so rendering it is one indexed lookup rather than a scan across history.
 */
export async function getLastPerformance(
  exerciseId: string,
): Promise<LastPerformance | undefined> {
  return db.lastPerformance.get(exerciseId)
}

/** Recomputes the cache for one exercise from the last 3 sessions containing it. */
export async function rebuildLastPerformance(exerciseId: string): Promise<void> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return

  const workoutExercises = (
    await db.workoutExercises.where('exerciseId').equals(exerciseId).toArray()
  ).filter((we) => we.deletedAt === null)

  const sessions: PerformedSession[] = []
  for (const we of workoutExercises) {
    const workout = await db.workouts.get(we.workoutId)
    if (!workout || workout.deletedAt !== null) continue
    const sets = (await listSets(we.id)).filter((s) => s.isCompleted)
    if (sets.length === 0) continue

    sessions.push({
      workoutId: workout.id,
      performedAt: workout.startedAt,
      sets: sets.map((s) => ({
        weightKg: s.weightKg,
        reps: s.reps,
        durationSeconds: s.durationSeconds,
        distanceM: s.distanceM,
        rpe: s.rpe,
      })),
      bestE1rmKg: bestOneRepMaxKg(sets),
      volumeKg: volumeLoadKg(sets, exercise, workout.bodyweightKg),
    })
  }

  sessions.sort((a, b) => b.performedAt - a.performedAt)

  await db.lastPerformance.put({
    exerciseId,
    sessions: sessions.slice(0, 3),
    updatedAt: Date.now(),
  })
}

/** Called on finish and after editing a past workout, which invalidates the cache. */
export async function rebuildLastPerformanceForWorkout(workoutId: string): Promise<void> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  for (const we of workoutExercises) {
    await rebuildLastPerformance(we.exerciseId)
    await refreshPersonalRecords(we.exerciseId)
  }
}

export interface SetPlaceholder {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
}

/**
 * What to show as placeholder values on a set row (§6.2).
 *
 * Precedence, in order:
 *   1. The same set index from the most recent session containing this exercise
 *   2. **The last logged set of the current session** — so adding a 4th set to a
 *      3-set history suggests set 3's numbers instead of going blank at the exact
 *      moment the user is most tired
 *   3. The final set of the previous session
 *   4. Nothing, for a first-ever performance
 *
 * `currentSessionSets` is optional so callers that only have history (a template
 * instantiation, say) can skip it.
 */
export async function getPrefillForSet(
  exerciseId: string,
  setIndex: number,
  currentSessionSets?: WorkoutSet[],
): Promise<SetPlaceholder | null> {
  const cache = await getLastPerformance(exerciseId)
  const history = (cache?.sessions[0]?.sets ?? []).filter(() => true)

  const fromHistory = history[setIndex]
  if (fromHistory) {
    return {
      weightKg: fromHistory.weightKg,
      reps: fromHistory.reps,
      durationSeconds: fromHistory.durationSeconds,
      distanceM: fromHistory.distanceM,
    }
  }

  // Beyond what history covers: carry forward what was just done in this session.
  const loggedThisSession = (currentSessionSets ?? []).filter((s) => s.isCompleted)
  const lastThisSession = loggedThisSession[loggedThisSession.length - 1]
  if (lastThisSession) {
    return {
      weightKg: lastThisSession.weightKg,
      reps: lastThisSession.reps,
      durationSeconds: lastThisSession.durationSeconds,
      distanceM: lastThisSession.distanceM,
    }
  }

  const lastFromHistory = history[history.length - 1]
  if (lastFromHistory) {
    return {
      weightKg: lastFromHistory.weightKg,
      reps: lastFromHistory.reps,
      durationSeconds: lastFromHistory.durationSeconds,
      distanceM: lastFromHistory.distanceM,
    }
  }

  return null
}

/**
 * Adds a new (empty) set. The row's placeholder is resolved live by the exercise
 * card (§6.2): last time's matching set, or — for a row beyond history — the
 * numbers carried forward from earlier in this session. That means "Add set"
 * needs only to append the row; no placeholder has to be persisted here, which
 * removes the override-writing that made this fragile.
 */
export async function addSetWithPlaceholder(
  workoutExerciseId: string,
  _exerciseId: string,
): Promise<{ setId: string }> {
  const setId = await addSet({ workoutExerciseId })
  return { setId }
}

// ---------------------------------------------------------------- templates

export async function listTemplates(): Promise<Template[]> {
  const all = await db.templates.toArray()
  return all
    .filter((t) => t.deletedAt === null && !t.isArchived)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
}

export async function getTemplate(id: string): Promise<Template | undefined> {
  const template = await db.templates.get(id)
  return template?.deletedAt === null ? template : undefined
}

export async function listTemplateExercises(
  templateId: string,
): Promise<TemplateExercise[]> {
  const rows = await db.templateExercises.where('templateId').equals(templateId).toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.position - b.position)
}

// -------------------------------------------------- template editing (§7)

/**
 * Creates an empty template. Editing it afterward mutates the plan only — never
 * a workout, past or present (§4.7). The two are deliberately separate: a
 * workout keeps its own copy of what was planned, so retuning a template never
 * rewrites history.
 */
export async function createTemplate(
  name: string,
  folder: string | null = null,
): Promise<string> {
  const template: Template = {
    id: newId(),
    userId: getActiveUserId(),
    name: name.trim() || 'New template',
    description: '',
    folder,
    lastUsedAt: null,
    timesUsed: 0,
    isArchived: false,
    ...syncStamp(),
  }
  await db.templates.add(template)
  await enqueue('templates', 'insert', template.id, template, template.clientRev)
  return template.id
}

export async function updateTemplate(
  id: string,
  patch: Partial<Template>,
): Promise<void> {
  await patchRow(db.templates, 'templates', id, patch)
}

/** Soft-deletes a template. Workouts already run from it keep their own copy. */
export async function deleteTemplate(id: string): Promise<void> {
  await patchRow(db.templates, 'templates', id, { deletedAt: Date.now() })
}

export async function restoreTemplate(id: string): Promise<void> {
  await patchRow(db.templates, 'templates', id, { deletedAt: null })
}

export async function addExerciseToTemplate(
  templateId: string,
  exerciseId: string,
): Promise<string> {
  const existing = await listTemplateExercises(templateId)
  const row: TemplateExercise = {
    id: newId(),
    templateId,
    exerciseId,
    position: existing.length,
    supersetGroup: null,
    targetSets: 3,
    targetRepsLow: null,
    targetRepsHigh: null,
    targetWeightKg: null,
    targetRpe: null,
    restSeconds: null,
    notes: '',
    progression: null,
    ...syncStamp(),
  }
  await db.templateExercises.add(row)
  await enqueue('templateExercises', 'insert', row.id, row, row.clientRev)
  return row.id
}

export async function updateTemplateExercise(
  id: string,
  patch: Partial<TemplateExercise>,
): Promise<void> {
  await patchRow(db.templateExercises, 'templateExercises', id, patch)
}

export async function removeTemplateExercise(id: string): Promise<void> {
  await patchRow(db.templateExercises, 'templateExercises', id, { deletedAt: Date.now() })
}

export async function reorderTemplateExercises(orderedIds: string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await updateTemplateExercise(id, { position: index })
  }
}

/**
 * Materialize a coach plan (§13) into real templates — one per session.
 *
 * Each plan exercise is matched to a library exercise by name or alias
 * (case-insensitive); an unmatched name is skipped rather than inventing an
 * exercise, and the skipped names are returned so the UI can say so. Weights in
 * the plan are in the user's unit and converted back to canonical kg here.
 *
 * The plan is always reviewed/edited in the UI before this runs — nothing the
 * coach proposes is auto-applied (§13).
 */
export async function createTemplatesFromPlan(plan: {
  sessions: {
    name: string
    exercises: {
      name: string
      sets: number
      repLow: number
      repHigh: number
      weight: number | null
      autoProgress?: boolean
    }[]
  }[]
  unitWeight: WeightUnit
  /** Folder to group the sessions under — a coach program's name (§13). */
  folder?: string | null
}): Promise<{ templateIds: string[]; unmatched: string[] }> {
  // Build a name/alias → id index over the live library once.
  const library = await listExercises()
  const byName = new Map<string, string>()
  for (const ex of library) {
    byName.set(ex.name.toLowerCase(), ex.id)
    for (const alias of ex.aliases) byName.set(alias.toLowerCase(), ex.id)
  }

  // A sensible default progression step for the user's unit, applied when the
  // plan flags an exercise for auto-progression.
  const incrementKg = plan.unitWeight === 'kg' ? 2.5 : weightToKg(5, 'lb')

  const templateIds: string[] = []
  const unmatched: string[] = []

  for (const session of plan.sessions) {
    // Resolve matches first, so a session where nothing matched creates no empty
    // template — a persisted "Upper" with zero exercises is just clutter.
    const matched = session.exercises.map((pe) => ({
      pe,
      exerciseId: byName.get(pe.name.trim().toLowerCase()),
    }))
    for (const { pe, exerciseId } of matched) {
      if (!exerciseId) unmatched.push(pe.name)
    }
    const resolved = matched.filter((m) => m.exerciseId)
    if (resolved.length === 0) continue

    const templateId = await createTemplate(session.name, plan.folder ?? null)
    templateIds.push(templateId)

    for (const { pe, exerciseId } of resolved) {
      const teId = await addExerciseToTemplate(templateId, exerciseId!)
      await updateTemplateExercise(teId, {
        targetSets: pe.sets,
        targetRepsLow: pe.repLow,
        targetRepsHigh: pe.repHigh,
        targetWeightKg:
          pe.weight === null ? null : weightToKg(pe.weight, plan.unitWeight),
        // Carry the coach's progression intent into a real rule (§7 Phase 4),
        // so a multi-week program's load increases happen automatically.
        progression: pe.autoProgress ? { kind: 'double', incrementKg, maxRpe: 8 } : null,
      })
    }
  }

  return { templateIds, unmatched }
}

/**
 * A read-only outline of a template, for the preview shown before starting a
 * workout from it (§7.4) — so the user confirms the plan before a session is
 * created, and understands the workout is a fresh copy.
 */
export async function getTemplatePreview(
  templateId: string,
): Promise<WorkoutPreview | null> {
  const template = await getTemplate(templateId)
  if (!template) return null
  const profile = await getProfile()
  const regionOf = await buildRegionMap()
  const templateExercises = await listTemplateExercises(templateId)

  const exercises: WorkoutPreview['exercises'] = []
  let totalSets = 0

  for (const te of templateExercises) {
    const exercise = await db.exercises.get(te.exerciseId)
    if (!exercise) continue
    const region = regionOf.get(exercise.primaryMuscleId)
    const sets = te.targetSets ?? 3
    totalSets += sets
    exercises.push({
      name: exercise.name,
      region,
      detail: describeTemplateTarget(te, profile.unitWeight),
      setCount: sets,
    })
  }

  return { title: template.name, performedAt: null, exercises, totalSets }
}

/** "3 × 8-10 @ 60 lb" from a template exercise's targets, in the user's unit. */
export function describeTemplateTarget(
  te: TemplateExercise,
  weightUnit: WeightUnit,
): string {
  const sets = te.targetSets ?? 3
  const parts: string[] = [`${sets} sets`]
  if (te.targetRepsLow !== null || te.targetRepsHigh !== null) {
    const low = te.targetRepsLow
    const high = te.targetRepsHigh
    if (low !== null && high !== null && low !== high)
      parts[0] = `${sets} × ${low}-${high}`
    else parts[0] = `${sets} × ${low ?? high}`
  }
  if (te.targetWeightKg !== null)
    parts.push(`@ ${formatWeight(te.targetWeightKg, weightUnit)}`)
  if (te.targetRpe !== null) parts.push(`RPE ${te.targetRpe}`)
  return parts.join(' ')
}

/**
 * Captures a finished session as a reusable template, with targets pre-filled
 * from what was actually done (§7).
 */
export async function saveWorkoutAsTemplate(
  workoutId: string,
  name: string,
  folder: string | null = null,
): Promise<string> {
  const workout = await getWorkout(workoutId)
  if (!workout) throw new Error('Workout not found')

  const template: Template = {
    id: newId(),
    userId: getActiveUserId(),
    name: name.trim(),
    description: '',
    folder,
    lastUsedAt: null,
    timesUsed: 0,
    isArchived: false,
    ...syncStamp(),
  }
  await db.templates.add(template)
  await enqueue('templates', 'insert', template.id, template, template.clientRev)

  const workoutExercises = await listWorkoutExercises(workoutId)
  for (const we of workoutExercises) {
    const sets = (await listSets(we.id)).filter((s) => s.isCompleted)
    const reps = sets.map((s) => s.reps).filter((r): r is number => r !== null)
    const weights = sets.map((s) => s.weightKg).filter((w): w is number => w !== null)

    const row: TemplateExercise = {
      id: newId(),
      templateId: template.id,
      exerciseId: we.exerciseId,
      position: we.position,
      supersetGroup: we.supersetGroup,
      targetSets: sets.length || null,
      targetRepsLow: reps.length > 0 ? Math.min(...reps) : null,
      targetRepsHigh: reps.length > 0 ? Math.max(...reps) : null,
      targetWeightKg: weights.length > 0 ? Math.max(...weights) : null,
      targetRpe: null,
      restSeconds: we.restSeconds,
      notes: '',
      progression: null,
      ...syncStamp(),
    }
    await db.templateExercises.add(row)
    await enqueue('templateExercises', 'insert', row.id, row, row.clientRev)
  }

  return template.id
}

/**
 * Instantiates a template as a live workout, with planned sets already laid out
 * as unchecked rows so the session reads as a checklist (§7).
 */
export async function startWorkoutFromTemplate(templateId: string): Promise<string> {
  const template = await getTemplate(templateId)
  if (!template) throw new Error('Template not found')

  const workoutId = await startWorkout({ title: template.name, templateId })
  const templateExercises = await listTemplateExercises(templateId)
  const placeholders: Record<string, SetPlaceholder> = {}

  for (const te of templateExercises) {
    const workoutExerciseId = await addExerciseToWorkout(workoutId, te.exerciseId)
    if (te.supersetGroup !== null) {
      await updateWorkoutExercise(workoutExerciseId, {
        supersetGroup: te.supersetGroup,
        restSeconds: te.restSeconds,
      })
    }

    // Apply a progression rule (§7 Phase 4) if the template-exercise has one:
    // nudge the seeded weight/reps based on how the last session against this
    // exercise went. Deterministic and total — with no rule or no history it
    // just returns the template's own targets unchanged.
    let seedWeightKg = te.targetWeightKg
    let targetReps = te.targetRepsLow ?? te.targetRepsHigh
    if (te.progression) {
      const last = (await getLastPerformance(te.exerciseId))?.sessions[0]
      const stepped = nextTarget({
        rule: te.progression,
        targetWeightKg: te.targetWeightKg,
        targetRepsLow: te.targetRepsLow,
        targetRepsHigh: te.targetRepsHigh,
        lastSets: (last?.sets ?? []).map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
          rpe: s.rpe ?? null,
        })),
      })
      seedWeightKg = stepped.targetWeightKg
      targetReps = stepped.targetReps
    }

    // Empty rows. The template supplies the *shape* — how many sets — while the
    // numbers show as placeholders. A template target seeds the ghost when it
    // has one; otherwise the placeholder falls back to history at log time
    // (§6.2). Either way the row stays unlogged until the user types or taps.
    const targetSets = te.targetSets ?? 3
    for (let index = 0; index < targetSets; index += 1) {
      const setId = await addSet({ workoutExerciseId })
      if (seedWeightKg !== null || targetReps !== null) {
        placeholders[setId] = {
          weightKg: seedWeightKg,
          reps: targetReps,
          durationSeconds: null,
          distanceM: null,
        }
      }
    }
  }

  if (Object.keys(placeholders).length > 0) {
    await savePlaceholderOverrides(workoutId, placeholders)
  }

  // Through updateTemplate so this "used it" bump enqueues and bumps clientRev
  // like every other template edit — a raw db.update here never synced and left
  // the row's revision stale, so a later pull could clobber it.
  await updateTemplate(templateId, {
    lastUsedAt: Date.now(),
    timesUsed: template.timesUsed + 1,
  })

  return workoutId
}

/**
 * Copies any past session into a new one (§7.2).
 *
 * Rows are created empty — nothing is pre-logged — but the *source session's*
 * numbers are returned as placeholders keyed by set id. Repeating a session from
 * six weeks ago should suggest what was done then, which is the whole reason for
 * choosing that session over the most recent one.
 *
 * Distinct from saving a template: no template row is created.
 */
export async function repeatWorkout(
  sourceWorkoutId: string,
): Promise<{ workoutId: string; placeholders: Record<string, SetPlaceholder> } | null> {
  const source = await getWorkout(sourceWorkoutId)
  if (!source) return null

  const workoutId = await startWorkout({ title: source.title })
  const workoutExercises = await listWorkoutExercises(sourceWorkoutId)
  const placeholders: Record<string, SetPlaceholder> = {}

  for (const we of workoutExercises) {
    const newWorkoutExerciseId = await addExerciseToWorkout(workoutId, we.exerciseId)
    if (we.supersetGroup !== null) {
      await updateWorkoutExercise(newWorkoutExerciseId, {
        supersetGroup: we.supersetGroup,
      })
    }
    const previousSets = (await listSets(we.id)).filter((s) => s.isCompleted)
    for (const set of previousSets) {
      const setId = await addSet({
        workoutExerciseId: newWorkoutExerciseId,
      })
      placeholders[setId] = {
        weightKg: set.weightKg,
        reps: set.reps,
        durationSeconds: set.durationSeconds,
        distanceM: set.distanceM,
      }
    }
  }

  await savePlaceholderOverrides(workoutId, placeholders)
  return { workoutId, placeholders }
}

/**
 * Stores per-set placeholder overrides for a session (§7.2).
 *
 * Kept in a local-only table rather than on `sets`, because these are a UI hint
 * about a *specific repeat*, not data about the workout — they must not sync, and
 * they're meaningless once the set is logged.
 */
export async function savePlaceholderOverrides(
  workoutId: string,
  placeholders: Record<string, SetPlaceholder>,
): Promise<void> {
  // An empty map clears the row rather than being ignored, so overrides can be
  // removed as well as added.
  if (Object.keys(placeholders).length === 0) {
    await db.placeholderOverrides.delete(workoutId)
    return
  }
  await db.placeholderOverrides.put({ workoutId, placeholders, createdAt: Date.now() })
}

export async function getPlaceholderOverrides(
  workoutId: string,
): Promise<Record<string, SetPlaceholder>> {
  const row = await db.placeholderOverrides.get(workoutId)
  return row?.placeholders ?? {}
}

// ------------------------------------------------------------ body metrics

export async function listMetricEntries(
  definitionId: string,
  limit = 500,
): Promise<MetricEntry[]> {
  const rows = await db.metricEntries
    .where('definitionId')
    .equals(definitionId)
    .reverse()
    .limit(limit)
    .toArray()
  return rows
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => b.measuredAt - a.measuredAt)
}

export async function addMetricEntry(input: {
  definitionId: string
  value: number
  measuredAt?: number
  notes?: string
}): Promise<string> {
  // Guard against a NaN or non-positive measurement poisoning the charts (and,
  // for bodyweight, the volume math it feeds). Callers validate too, but this is
  // the durable boundary.
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new Error('Metric value must be a positive number')
  }
  const entry: MetricEntry = {
    id: newId(),
    userId: getActiveUserId(),
    definitionId: input.definitionId,
    measuredAt: input.measuredAt ?? Date.now(),
    value: input.value,
    notes: input.notes ?? '',
    ...syncStamp(),
  }
  await db.metricEntries.add(entry)
  await enqueue('metricEntries', 'insert', entry.id, entry, entry.clientRev)

  // Bodyweight feeds volume math for bodyweight exercises, so cache the latest.
  if (input.definitionId === 'bodyweight') {
    await updateProfile({ bodyweightCacheKg: input.value })
  }

  return entry.id
}

export async function deleteMetricEntry(id: string): Promise<void> {
  await patchRow(db.metricEntries, 'metricEntries', id, { deletedAt: Date.now() })
}

// ------------------------------------------------------------- maintenance

/**
 * Soft-deletes every workout, template, custom exercise, and metric entry —
 * *through the outbox*, so the deletions propagate to the server.
 *
 * The difference from `clearLocalData` matters. That one wipes IndexedDB and
 * drops the queue, so on a synced account the next pull simply rehydrates
 * everything from the server. This one issues a real tombstone per row, which is
 * how a delete is represented in pull-based sync (§4.11) — so the data goes away
 * on every device, permanently.
 *
 * The shared system library is untouched (it isn't user data).
 *
 * **Not** what the "permanently erase" button uses. A tombstone leaves every row
 * in Postgres, which isn't what erasing your data should mean, so that path uses
 * `SyncEngine.hardDeleteServerData()` for a real DELETE. This remains the right
 * primitive for a *selective*, reversible, sync-correct bulk delete (and is what
 * you want if erasure ever needs to be undoable), so it's kept and tested.
 *
 * Returns per-kind counts, so a caller can report exactly what it removed.
 */
export async function deleteAllTrainingData(): Promise<{
  workouts: number
  templates: number
  customExercises: number
  metricEntries: number
}> {
  const counts = { workouts: 0, templates: 0, customExercises: 0, metricEntries: 0 }
  const now = Date.now()

  // Workouts. Tombstoning the parent is what hides the session everywhere; its
  // exercises and sets are filtered by the parent on read, and the server's
  // chained RLS means they don't each need their own tombstone.
  for (const workout of await db.workouts.toArray()) {
    if (workout.deletedAt !== null) continue
    await patchRow(db.workouts, 'workouts', workout.id, { deletedAt: now })
    counts.workouts += 1
  }

  for (const template of await db.templates.toArray()) {
    if (template.deletedAt !== null) continue
    await patchRow(db.templates, 'templates', template.id, { deletedAt: now })
    counts.templates += 1
  }

  for (const entry of await db.metricEntries.toArray()) {
    if (entry.deletedAt !== null) continue
    await patchRow(db.metricEntries, 'metricEntries', entry.id, { deletedAt: now })
    counts.metricEntries += 1
  }

  // Custom exercises only — never the system library (userId === null).
  for (const exercise of await db.exercises.toArray()) {
    if (exercise.userId === null || exercise.deletedAt !== null) continue
    await patchRow(db.exercises, 'exercises', exercise.id, { deletedAt: now })
    counts.customExercises += 1
  }

  // Derived caches are rebuilt from what's left, so they're safe to drop.
  await db.personalRecords.clear()
  await db.lastPerformance.clear()
  await db.placeholderOverrides.clear()

  return counts
}

/**
 * Tombstones finished workouts that contain no completed set (§6.4.1).
 *
 * `finishWorkout` already discards an empty session, so these can't be created
 * through the normal path — but they still turn up two ways: pulled from the
 * server (written by an older build, or by a device whose sets failed to push),
 * and left behind when a session is interrupted so `finishWorkout` never runs.
 * Either way an empty session is noise in history and skews the counts, so this
 * removes them through the outbox like any other delete.
 *
 * In-progress workouts (`endedAt === null`) are never touched — one may be open
 * right now with sets about to be logged.
 *
 * Returns how many were removed.
 */
export async function purgeEmptyWorkouts(): Promise<number> {
  const finished = (await db.workouts.toArray()).filter(
    (w) => w.deletedAt === null && w.endedAt !== null,
  )

  let removed = 0
  for (const workout of finished) {
    if (await hasLoggedWork(workout.id)) continue
    await deleteWorkout(workout.id)
    await db.placeholderOverrides.delete(workout.id)
    removed += 1
  }
  return removed
}

/**
 * Wipes all local training data and the sync queues, then re-seeds the shared
 * library and a fresh profile.
 *
 * For starting a clean sync test, or recovering from stale prototype data
 * stamped with the old `local-user` id. This clears IndexedDB only — it does
 * NOT delete anything already on the server. After a wipe the next pull rehydrates
 * whatever the server holds for the signed-in user, so on a synced account this
 * is a "resync from the server" rather than true deletion; on an offline account
 * it is a genuine reset.
 */
export async function clearLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.profiles,
      db.workouts,
      db.workoutExercises,
      db.sets,
      db.templates,
      db.templateExercises,
      db.personalRecords,
      db.metricEntries,
      db.exercises,
      db.lastPerformance,
      db.placeholderOverrides,
      db.outbox,
      db.deadLetter,
      db.syncState,
    ],
    async () => {
      // User-owned data.
      await db.workouts.clear()
      await db.workoutExercises.clear()
      await db.sets.clear()
      await db.templates.clear()
      await db.templateExercises.clear()
      await db.personalRecords.clear()
      await db.metricEntries.clear()
      await db.lastPerformance.clear()
      await db.placeholderOverrides.clear()
      await db.profiles.clear()
      // Custom exercises only — the system library is re-seeded below.
      await db.exercises.filter((e) => e.userId !== null).delete()
      // Sync bookkeeping: drop queued/failed writes and reset delta cursors so
      // the next pull starts from zero.
      await db.outbox.clear()
      await db.deadLetter.clear()
      await db.syncState.clear()
    },
  )
}
