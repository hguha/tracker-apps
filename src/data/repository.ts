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
import { getActiveUserId } from '@/db/seed'
import { formatDistance, formatWeight } from '@/lib/units'
import { bestOneRepMaxKg, estimatedOneRepMaxKg, volumeLoadKg } from '@/lib/metrics'
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
  SetType,
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

// ------------------------------------------------------------------ profile

export async function getProfile(): Promise<Profile> {
  const profile = await db.profiles.get(getActiveUserId())
  if (!profile) throw new Error('Profile missing — seeding did not run')
  return profile
}

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  const current = await getProfile()
  const next = { ...patch, ...touch(current.clientRev) }
  await db.profiles.update(getActiveUserId(), next)
  await enqueue('profiles', 'update', getActiveUserId(), next, current.clientRev + 1)
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
  const current = await db.exercises.get(id)
  if (!current) return
  const next = { ...patch, ...touch(current.clientRev) }
  await db.exercises.update(id, next)
  await enqueue('exercises', 'update', id, next, current.clientRev + 1)
}

export async function toggleKeyLift(id: string): Promise<void> {
  const current = await db.exercises.get(id)
  if (!current) return
  await updateExercise(id, { isKeyLift: !current.isKeyLift })
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
    secondaryMuscles: secondaries.filter(
      (s): s is NonNullable<typeof s> => s !== null,
    ),
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
  const recent = await db.workouts.orderBy('startedAt').reverse().limit(200).toArray()
  const lastTrained = new Map<string, number>()
  for (const workout of recent) {
    if (workout.deletedAt !== null) continue
    for (const we of await listWorkoutExercises(workout.id)) {
      if (!lastTrained.has(we.exerciseId)) {
        lastTrained.set(we.exerciseId, workout.startedAt)
      }
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

export async function startWorkout(opts: {
  title?: string
  startedAt?: number
  templateId?: string | null
} = {}): Promise<string> {
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
  regions: Region[]
  setCount: number
  volumeKg: number
  durationSeconds: number | null
  cardioSeconds: number
}

export async function getWorkoutSummary(
  workout: Workout,
  regionOf?: Map<string, Region>,
): Promise<WorkoutSummary> {
  const regions = regionOf ?? (await buildRegionMap())
  const workoutExercises = await listWorkoutExercises(workout.id)

  const exerciseNames: string[] = []
  const regionSet = new Set<Region>()
  let setCount = 0
  let volumeKg = 0
  let cardioSeconds = 0
  const signals: SetSignal[] = []

  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId)
    if (!exercise) continue
    exerciseNames.push(exercise.name)

    const region = regions.get(exercise.primaryMuscleId)
    if (region) regionSet.add(region)

    const logged = (await listSets(we.id)).filter((s) => s.isCompleted)
    setCount += logged.length
    volumeKg += volumeLoadKg(logged, exercise, workout.bodyweightKg)

    if (exercise.movementPattern === 'cardio') {
      cardioSeconds += logged.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
    }

    for (const set of logged) {
      if (set.setType !== 'warmup') {
        signals.push({ region: region!, pattern: exercise.movementPattern })
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
    regions: [...regionSet],
    setCount,
    volumeKg,
    durationSeconds:
      workout.endedAt !== null ? (workout.endedAt - workout.startedAt) / 1000 : null,
    cardioSeconds,
  }
}

export async function listWorkoutSummaries(limit = 100): Promise<WorkoutSummary[]> {
  const regionOf = await buildRegionMap()
  const workouts = await listWorkouts(limit)
  return Promise.all(workouts.map((w) => getWorkoutSummary(w, regionOf)))
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
    for (const set of logged) {
      if (set.setType !== 'warmup' && region) {
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
  sets: Pick<WorkoutSet, 'setType' | 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>[],
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  const working = sets.filter((s) => s.setType !== 'warmup')
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

export async function updateWorkout(
  id: string,
  patch: Partial<Workout>,
): Promise<void> {
  const current = await db.workouts.get(id)
  if (!current) return
  const next = { ...patch, ...touch(current.clientRev) }
  await db.workouts.update(id, next)
  await enqueue('workouts', 'update', id, next, current.clientRev + 1)
}

/**
 * Ends a session, or discards it if nothing was logged (§6.4.1).
 *
 * Returns what happened, so the UI can say so. An empty workout is not a record
 * of anything — saving one breaks streaks, dilutes averages, and leaves a row the
 * user can't identify.
 */
export async function finishWorkout(
  id: string,
): Promise<'saved' | 'discarded-empty'> {
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

/** Whether a session has any set with real values. */
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
  const current = await db.workouts.get(id)
  if (!current) return
  const next = { deletedAt: Date.now(), ...touch(current.clientRev) }
  await db.workouts.update(id, next)
  await enqueue('workouts', 'update', id, next, current.clientRev + 1)
  // A discarded workout's sets no longer count toward records.
  await rebuildLastPerformanceForWorkout(id)
}

/** Backs the undo on a discarded workout. */
export async function restoreWorkout(id: string): Promise<void> {
  const current = await db.workouts.get(id)
  if (!current) return
  const next = { deletedAt: null, ...touch(current.clientRev) }
  await db.workouts.update(id, next)
  await enqueue('workouts', 'update', id, next, current.clientRev + 1)
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
  const current = await db.workoutExercises.get(id)
  if (!current) return
  const next = { ...patch, ...touch(current.clientRev) }
  await db.workoutExercises.update(id, next)
  await enqueue('workoutExercises', 'update', id, next, current.clientRev + 1)
}

export async function removeWorkoutExercise(id: string): Promise<void> {
  const current = await db.workoutExercises.get(id)
  if (!current) return
  const next = { deletedAt: Date.now(), ...touch(current.clientRev) }
  await db.workoutExercises.update(id, next)
  await enqueue('workoutExercises', 'update', id, next, current.clientRev + 1)
}

/** Restores a swipe-deleted exercise. Backs the undo toast (§6.4). */
export async function restoreWorkoutExercise(id: string): Promise<void> {
  const current = await db.workoutExercises.get(id)
  if (!current) return
  const next = { deletedAt: null, ...touch(current.clientRev) }
  await db.workoutExercises.update(id, next)
  await enqueue('workoutExercises', 'update', id, next, current.clientRev + 1)
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
    existingGroup ??
    Math.max(0, ...siblings.map((s) => s.supersetGroup ?? 0)) + 1

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
export async function getSessionTitleSignals(
  workoutId: string,
): Promise<SetSignal[]> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  const signals: SetSignal[] = []

  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId)
    if (!exercise) continue
    const muscle = await db.muscles.get(exercise.primaryMuscleId)
    if (!muscle) continue

    const working = (await listSets(we.id)).filter(
      (s) => s.isCompleted && s.setType !== 'warmup',
    )
    for (let i = 0; i < working.length; i += 1) {
      signals.push({ region: muscle.region, pattern: exercise.movementPattern })
    }
  }

  return signals
}

// --------------------------------------------------------------------- sets

export async function listSets(workoutExerciseId: string): Promise<WorkoutSet[]> {
  const rows = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.position - b.position)
}

export async function listSetsForWorkout(workoutId: string): Promise<WorkoutSet[]> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  const perExercise = await Promise.all(workoutExercises.map((we) => listSets(we.id)))
  return perExercise.flat()
}

export interface NewSetInput {
  workoutExerciseId: string
  setType?: SetType
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
  distanceM?: number | null
  isCompleted?: boolean
  enteredUnit?: WeightUnit | null
  /** Insert directly after this set instead of at the end (dropsets, duplicate). */
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
    setType: input.setType ?? 'normal',
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

export async function updateSet(
  id: string,
  patch: Partial<WorkoutSet>,
): Promise<void> {
  const current = await db.sets.get(id)
  if (!current) return
  const next = { ...patch, ...touch(current.clientRev) }
  await db.sets.update(id, next)
  await enqueue('sets', 'update', id, next, current.clientRev + 1)
}

export async function deleteSet(id: string): Promise<void> {
  const current = await db.sets.get(id)
  if (!current) return
  const next = { deletedAt: Date.now(), ...touch(current.clientRev) }
  await db.sets.update(id, next)
  await enqueue('sets', 'update', id, next, current.clientRev + 1)
}

export async function restoreSet(id: string): Promise<void> {
  const current = await db.sets.get(id)
  if (!current) return
  const next = { deletedAt: null, ...touch(current.clientRev) }
  await db.sets.update(id, next)
  await enqueue('sets', 'update', id, next, current.clientRev + 1)
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
    const workingIndex = siblings
      .filter((s) => s.setType !== 'warmup')
      .findIndex((s) => s.id === setId)

    prefill = await getPrefillForSet(
      workoutExercise.exerciseId,
      workingIndex < 0 ? 0 : workingIndex,
    )
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
 */
export async function previewRecords(
  exerciseId: string,
  candidate: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM' | 'setType'>,
): Promise<RecordType[]> {
  if (candidate.setType === 'warmup') return []

  const existing = await listPersonalRecords(exerciseId)
  if (existing.length === 0) return []
  const best = new Map(existing.map((pr) => [pr.recordType, pr.value]))

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

/** Clears a set's values, returning it to placeholder state. */
export async function clearSetValues(id: string): Promise<void> {
  await updateSet(id, {
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceM: null,
    isCompleted: false,
    completedAt: null,
  })
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
export async function refreshPersonalRecords(
  exerciseId: string,
): Promise<RecordType[]> {
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
    const sets = (await listSets(we.id)).filter(
      (s) => s.isCompleted && s.setType !== 'warmup',
    )
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
      const previous = before.get(pr.recordType)
      return previous !== undefined && pr.value > previous
    })
    .map((pr) => pr.recordType)
}

export async function listPersonalRecords(
  exerciseId: string,
): Promise<PersonalRecord[]> {
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
        setType: s.setType,
        weightKg: s.weightKg,
        reps: s.reps,
        durationSeconds: s.durationSeconds,
        distanceM: s.distanceM,
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
export async function rebuildLastPerformanceForWorkout(
  workoutId: string,
): Promise<void> {
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
  const history = (cache?.sessions[0]?.sets ?? []).filter(
    (s) => s.setType !== 'warmup',
  )

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
  const loggedThisSession = (currentSessionSets ?? []).filter(
    (s) => s.isCompleted && s.setType !== 'warmup',
  )
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
  const current = await db.templates.get(id)
  if (!current) return
  const next = { ...patch, ...touch(current.clientRev) }
  await db.templates.update(id, next)
  await enqueue('templates', 'update', id, next, current.clientRev + 1)
}

/** Soft-deletes a template. Workouts already run from it keep their own copy. */
export async function deleteTemplate(id: string): Promise<void> {
  const current = await db.templates.get(id)
  if (!current) return
  const next = { deletedAt: Date.now(), ...touch(current.clientRev) }
  await db.templates.update(id, next)
  await enqueue('templates', 'update', id, next, current.clientRev + 1)
}

export async function restoreTemplate(id: string): Promise<void> {
  const current = await db.templates.get(id)
  if (!current) return
  const next = { deletedAt: null, ...touch(current.clientRev) }
  await db.templates.update(id, next)
  await enqueue('templates', 'update', id, next, current.clientRev + 1)
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
  const current = await db.templateExercises.get(id)
  if (!current) return
  const next = { ...patch, ...touch(current.clientRev) }
  await db.templateExercises.update(id, next)
  await enqueue('templateExercises', 'update', id, next, current.clientRev + 1)
}

export async function removeTemplateExercise(id: string): Promise<void> {
  const current = await db.templateExercises.get(id)
  if (!current) return
  const next = { deletedAt: Date.now(), ...touch(current.clientRev) }
  await db.templateExercises.update(id, next)
  await enqueue('templateExercises', 'update', id, next, current.clientRev + 1)
}

export async function reorderTemplateExercises(orderedIds: string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await updateTemplateExercise(id, { position: index })
  }
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
    if (low !== null && high !== null && low !== high) parts[0] = `${sets} × ${low}-${high}`
    else parts[0] = `${sets} × ${low ?? high}`
  }
  if (te.targetWeightKg !== null) parts.push(`@ ${formatWeight(te.targetWeightKg, weightUnit)}`)
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
    const sets = (await listSets(we.id)).filter(
      (s) => s.isCompleted && s.setType !== 'warmup',
    )
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

    // Empty rows. The template supplies the *shape* — how many sets — while the
    // numbers show as placeholders. A template target seeds the ghost when it
    // has one; otherwise the placeholder falls back to history at log time
    // (§6.2). Either way the row stays unlogged until the user types or taps.
    const targetSets = te.targetSets ?? 3
    const targetReps = te.targetRepsLow ?? te.targetRepsHigh
    for (let index = 0; index < targetSets; index += 1) {
      const setId = await addSet({ workoutExerciseId })
      if (te.targetWeightKg !== null || targetReps !== null) {
        placeholders[setId] = {
          weightKg: te.targetWeightKg,
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

  await db.templates.update(templateId, {
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
    const previousSets = (await listSets(we.id)).filter(
      (s) => s.isCompleted && s.setType !== 'warmup',
    )
    for (const set of previousSets) {
      const setId = await addSet({
        workoutExerciseId: newWorkoutExerciseId,
        setType: set.setType,
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

/** Repeats the most recent finished session. */
export async function repeatLastWorkout(): Promise<string | null> {
  const finished = (await listWorkouts(20)).filter((w) => w.endedAt !== null)
  const last = finished[0]
  if (!last) return null
  const result = await repeatWorkout(last.id)
  return result?.workoutId ?? null
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
  const current = await db.metricEntries.get(id)
  if (!current) return
  const next = { deletedAt: Date.now(), ...touch(current.clientRev) }
  await db.metricEntries.update(id, next)
  await enqueue('metricEntries', 'update', id, next, current.clientRev + 1)
}

// ------------------------------------------------------------- maintenance

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
