import { db, syncStamp } from '@/db/database'
import { getActiveUserId } from '@/db/seed'
import { type Equipment, type Workout, type WorkoutExercise } from '@/domain/types'
import { type SetSignal } from '@/lib/sessionTitle'
import {
  dropQueuedWrites,
  enqueue,
  isWorkoutUnsent,
  newId,
  patchRow,
  releaseDeferredWrites,
  requeueWorkoutSubtree,
} from './outbox'
import { getProfile } from './profile'
import { rebuildLastPerformanceForWorkout } from './records'
import { addSet, deleteSet, listSets, setHasValues, type SetPlaceholder } from './sets'
import { getTemplate } from './templates'

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

export async function updateWorkout(id: string, patch: Partial<Workout>): Promise<void> {
  await patchRow(db.workouts, 'workouts', id, patch)
}

// Ends a session, or discards it if nothing was logged (§6.4.1).

export async function finishWorkout(id: string): Promise<'saved' | 'discarded-empty'> {
  await discardEmptySets(id)

  if (!(await hasLoggedWork(id))) {
    await deleteWorkout(id)
    await db.placeholderOverrides.delete(id)
    // Release even on discard, or the tombstone sits behind its own deferral.
    await releaseDeferredWrites(id)
    return 'discarded-empty'
  }

  await updateWorkout(id, { endedAt: Date.now() })
  await rebuildLastPerformanceForWorkout(id)
  await db.placeholderOverrides.delete(id)
  // Session complete: let everything it queued push at once (§5.5).
  await releaseDeferredWrites(id)
  return 'saved'
}

// Snapshots workout/exercises/sets so Cancel can restore (§6.6); re-opening keeps the original.

export async function beginWorkoutEdits(workoutId: string): Promise<void> {
  if (await db.editSnapshots.get(workoutId)) return

  const workout = await db.workouts.get(workoutId)
  if (!workout) return

  const workoutExercises = await db.workoutExercises
    .where('workoutId')
    .equals(workoutId)
    .toArray()
  const sets = (
    await Promise.all(
      workoutExercises.map((we) =>
        db.sets.where('workoutExerciseId').equals(we.id).toArray(),
      ),
    )
  ).flat()

  await db.editSnapshots.put({
    workoutId,
    workout,
    // Tombstones included, so a set deleted during the edit can come back.
    workoutExercises,
    sets,
    createdAt: Date.now(),
  })
}

// Clears deferrals left behind by a workout that is no longer in progress and is
// not open for editing — an earlier build could strand them, and a held write is
// invisible: it never pushes and nothing retries it. Returns how many it freed.

export async function hasUnsavedWorkoutEdits(workoutId: string): Promise<boolean> {
  const held = await db.outbox.where('deferredForWorkoutId').equals(workoutId).count()
  return held > 0
}

export async function commitWorkoutEdits(workoutId: string): Promise<void> {
  const snapshot = await db.editSnapshots.get(workoutId)
  if (!snapshot) return

  await db.editSnapshots.delete(workoutId)
  // An edit can invalidate a record — a weight corrected downward removes a PR (§6.6).
  await rebuildLastPerformanceForWorkout(workoutId)
  await releaseDeferredWrites(workoutId)
}

// Cancel: rows added during the edit are deleted outright, not tombstoned — never pushed.

export async function cancelWorkoutEdits(workoutId: string): Promise<void> {
  const snapshot = await db.editSnapshots.get(workoutId)
  if (!snapshot) return

  await db.transaction(
    'rw',
    [db.workouts, db.workoutExercises, db.sets, db.outbox, db.editSnapshots],
    async () => {
      const keptExerciseIds = new Set(snapshot.workoutExercises.map((we) => we.id))
      const keptSetIds = new Set(snapshot.sets.map((s) => s.id))

      const currentExercises = await db.workoutExercises
        .where('workoutId')
        .equals(workoutId)
        .toArray()
      for (const we of currentExercises) {
        const currentSets = await db.sets
          .where('workoutExerciseId')
          .equals(we.id)
          .toArray()
        for (const set of currentSets) {
          if (!keptSetIds.has(set.id)) await db.sets.delete(set.id)
        }
        if (!keptExerciseIds.has(we.id)) await db.workoutExercises.delete(we.id)
      }

      await db.workouts.put(snapshot.workout)
      await db.workoutExercises.bulkPut(snapshot.workoutExercises)
      await db.sets.bulkPut(snapshot.sets)

      const queued = await db.outbox
        .where('deferredForWorkoutId')
        .equals(workoutId)
        .toArray()
      await db.outbox.bulkDelete(queued.map((entry) => entry.seq!))

      await db.editSnapshots.delete(workoutId)
    },
  )

  await rebuildLastPerformanceForWorkout(workoutId)
}

export async function hasLoggedWork(workoutId: string): Promise<boolean> {
  for (const we of await listWorkoutExercises(workoutId)) {
    const sets = await listSets(we.id)
    if (sets.some((s) => s.isCompleted)) return true
  }
  return false
}

// Removes placeholder rows never filled in (§6.2), on finish.

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

  for (const we of workoutExercises) {
    if ((await listSets(we.id)).length === 0) {
      await removeWorkoutExercise(we.id)
    }
  }

  return discarded
}

export async function deleteWorkout(id: string): Promise<void> {
  // Whether the server has ever heard of this workout, decided before the
  // tombstone muddies the queue.
  const isUnsent = await isWorkoutUnsent(id)

  // Soft delete only — a hard delete can't be represented in pull-based sync.
  await patchRow(db.workouts, 'workouts', id, { deletedAt: Date.now() })

  // Discarding a session means none of it is sent. When it never reached the
  // server there is nothing to tombstone either, so the whole queued subtree goes
  // — including the tombstone just enqueued above. Otherwise the parent's
  // tombstone is the only thing worth sending: it hides the children too.
  await dropQueuedWrites(id)
  if (!isUnsent) {
    const workout = await db.workouts.get(id)
    if (workout) {
      await enqueue('workouts', 'update', id, workout, workout.clientRev)
    }
  }
  await rebuildLastPerformanceForWorkout(id)
}

export async function restoreWorkout(id: string): Promise<void> {
  await patchRow(db.workouts, 'workouts', id, { deletedAt: null })
  // Discarding dropped the queued writes for this workout's exercises and sets, so
  // undo has to put them back or the session would live on this device only.
  await requeueWorkoutSubtree(id)
  await rebuildLastPerformanceForWorkout(id)
}

// Re-queues a workout and everything under it, in parent-first order. Deferral is
// re-applied by enqueue, so a restored in-progress session is held again.

export async function listWorkoutExercises(
  workoutId: string,
): Promise<WorkoutExercise[]> {
  const rows = await db.workoutExercises.where('workoutId').equals(workoutId).toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.position - b.position)
}

export async function addExerciseToWorkout(
  workoutId: string,
  exerciseId: string,
  equipment: Equipment,
): Promise<string> {
  const existing = await listWorkoutExercises(workoutId)
  // One past the highest position, not the row count — counting collides when positions aren't contiguous.
  const lastPosition = existing.reduce((max, we) => Math.max(max, we.position), -1)
  const row: WorkoutExercise = {
    id: newId(),
    workoutId,
    exerciseId,
    equipment,
    position: lastPosition + 1,
    supersetGroup: null,
    restSeconds: null,
    notes: '',
    ...syncStamp(),
  }
  await db.workoutExercises.add(row)
  await enqueue('workoutExercises', 'insert', row.id, row, row.clientRev)
  return row.id
}

export async function getWorkoutExercise(
  id: string,
): Promise<WorkoutExercise | undefined> {
  const row = await db.workoutExercises.get(id)
  return row?.deletedAt === null ? row : undefined
}

export async function updateWorkoutExercise(
  id: string,
  patch: Partial<WorkoutExercise>,
): Promise<void> {
  await patchRow(db.workoutExercises, 'workoutExercises', id, patch)
}

export async function removeWorkoutExercise(id: string): Promise<void> {
  const row = await db.workoutExercises.get(id)
  await patchRow(db.workoutExercises, 'workoutExercises', id, { deletedAt: Date.now() })
  if (row?.supersetGroup !== null && row !== undefined) {
    await collapseLoneSuperset(row.workoutId, row.supersetGroup!)
  }
}

async function collapseLoneSuperset(workoutId: string, group: number): Promise<void> {
  const remaining = (await listWorkoutExercises(workoutId)).filter(
    (s) => s.supersetGroup === group,
  )
  if (remaining.length === 1) {
    await updateWorkoutExercise(remaining[0]!.id, { supersetGroup: null })
  }
}

export async function restoreWorkoutExercise(id: string): Promise<void> {
  await patchRow(db.workoutExercises, 'workoutExercises', id, { deletedAt: null })
}

export async function reorderWorkoutExercises(orderedIds: string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await updateWorkoutExercise(id, { position: index })
  }
}

// Supersets two exercises by dropping one onto the other (§6.4); if either is
// already in a group, both join it rather than starting a new one.

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

  // A superset that isn't contiguous in the list reads as a mistake, so move the dragged card after its partner.
  const withoutDragged = siblings.filter((s) => s.id !== draggedId)
  const targetIndex = withoutDragged.findIndex((s) => s.id === targetId)
  const reordered = [
    ...withoutDragged.slice(0, targetIndex + 1),
    dragged,
    ...withoutDragged.slice(targetIndex + 1),
  ]
  await reorderWorkoutExercises(reordered.map((s) => s.id))
}

export async function removeFromSuperset(workoutExerciseId: string): Promise<void> {
  const row = await db.workoutExercises.get(workoutExerciseId)
  if (!row || row.supersetGroup === null) return

  const group = row.supersetGroup
  await updateWorkoutExercise(workoutExerciseId, { supersetGroup: null })
  await collapseLoneSuperset(row.workoutId, group)
}

export async function getSessionTitleSignals(workoutId: string): Promise<SetSignal[]> {
  const workoutExercises = await listWorkoutExercises(workoutId)
  const signals: SetSignal[] = []

  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId)
    if (!exercise) continue
    const working = (await listSets(we.id)).filter((s) => s.isCompleted)
    for (let i = 0; i < working.length; i += 1) {
      signals.push({ region: exercise.region, pattern: exercise.movementPattern })
    }
  }

  return signals
}

// ----- sets -----

export async function detachWorkoutFromTemplate(
  workoutId: string,
): Promise<string | null> {
  const workout = await db.workouts.get(workoutId)
  if (!workout || workout.templateId === null) return null
  const template = await getTemplate(workout.templateId)
  await updateWorkout(workoutId, { templateId: null })
  return template?.name ?? null
}

// Copies any past session into a new one (§7.2): rows are created empty, the source's
// numbers returned as placeholders keyed by set id. No template row is created.

export async function repeatWorkout(
  sourceWorkoutId: string,
): Promise<{ workoutId: string; placeholders: Record<string, SetPlaceholder> } | null> {
  const source = await getWorkout(sourceWorkoutId)
  if (!source) return null

  const workoutId = await startWorkout({ title: source.title })
  const workoutExercises = await listWorkoutExercises(sourceWorkoutId)
  const placeholders: Record<string, SetPlaceholder> = {}

  for (const we of workoutExercises) {
    const newWorkoutExerciseId = await addExerciseToWorkout(
      workoutId,
      we.exerciseId,
      we.equipment,
    )
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

// Per-set placeholder overrides for a session (§7.2), in a local-only table: they're a
// UI hint about a specific repeat, must not sync, and are meaningless once the set is logged.

export async function savePlaceholderOverrides(
  workoutId: string,
  placeholders: Record<string, SetPlaceholder>,
): Promise<void> {
  // An empty map clears the row, so overrides can be removed as well as added.
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

// ----- body metrics -----

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

// Enforces that the local database holds only the signed-in account's data (§11.1.3),
// since IndexedDB reads aren't scoped by user; switching accounts wipes the previous
// one's rows. Returns whether it wiped, so the caller can resync rather than show an empty app.
