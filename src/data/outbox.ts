// The durable write queue and the row-write helper every domain module builds on.
// One entry per dirty row (§5.5); the drain reads the row itself at push time.

import { db, touch } from '@/db/database'

export function newId(): string {
  // randomUUID is only defined in a secure context; dev over http://<lan-ip>
  // (phone-on-wifi testing) isn't one, so fall back rather than throw on every write.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'id-' + crypto.getRandomValues(new Uint32Array(4)).join('-')
}

/**
 * Marks a row as needing to reach the server.
 *
 * Idempotent per row: a second edit refreshes the existing entry rather than
 * appending, keeping its original `seq` so push order (parents before children)
 * is stable, and resetting the retry state because a fresh edit deserves a fresh
 * attempt. `deletedAt` needs no special case — a tombstone is just the row's
 * current state.
 */
export async function enqueue(table: string, rowId: string): Promise<void> {
  const deferredForWorkoutId = await deferralFor(table, rowId)
  const existing = await db.outbox.where('[table+rowId]').equals([table, rowId]).first()

  if (existing) {
    await db.outbox.update(existing.seq!, {
      deferredForWorkoutId,
      attempts: 0,
      lastError: undefined,
      nextAttemptAt: undefined,
    })
    return
  }

  await db.outbox.add({
    table,
    rowId,
    queuedAt: Date.now(),
    attempts: 0,
    deferredForWorkoutId,
  })
}

/**
 * The workout whose writes this row belongs to, if that workout is still being
 * written — an in-progress session or one open for editing (§5.5, §6.6). Held
 * writes don't reach the server until Finish, so a live session doesn't publish
 * half a workout and a cancelled edit publishes nothing.
 */
export async function deferralFor(
  table: string,
  rowId: string,
): Promise<string | undefined> {
  const workoutId = await owningWorkoutId(table, rowId)
  if (!workoutId) return undefined

  if ((await db.editSnapshots.get(workoutId)) !== undefined) return workoutId

  const workout = await db.workouts.get(workoutId)
  if (!workout || workout.endedAt !== null || workout.deletedAt !== null) return undefined
  return workoutId
}

// Walks a chained row up to its workout. Everything else stands alone.
async function owningWorkoutId(
  table: string,
  rowId: string,
): Promise<string | undefined> {
  if (table === 'workouts') return rowId
  if (table === 'workoutExercises') {
    return (await db.workoutExercises.get(rowId))?.workoutId
  }
  if (table === 'sets') {
    const set = await db.sets.get(rowId)
    if (!set) return undefined
    return (await db.workoutExercises.get(set.workoutExerciseId))?.workoutId
  }
  return undefined
}

/** Every queued write belonging to a workout, its exercises, and their sets. */
async function queuedWritesFor(workoutId: string) {
  const workoutExerciseIds = new Set(
    (await db.workoutExercises.where('workoutId').equals(workoutId).toArray()).map(
      (we) => we.id,
    ),
  )
  const setIds = new Set<string>()
  for (const weId of workoutExerciseIds) {
    for (const set of await db.sets.where('workoutExerciseId').equals(weId).toArray()) {
      setIds.add(set.id)
    }
  }

  return (await db.outbox.toArray()).filter((entry) => {
    if (entry.deferredForWorkoutId === workoutId) return true
    if (entry.table === 'workouts') return entry.rowId === workoutId
    if (entry.table === 'workoutExercises') return workoutExerciseIds.has(entry.rowId)
    if (entry.table === 'sets') return setIds.has(entry.rowId)
    return false
  })
}

/**
 * Forgets every queued write about a workout, so nothing of it is ever sent.
 *
 * For a discarded session the server never saw, sending an insert and then a
 * tombstone is not just wasted round trips — the insert carries `endedAt: null`
 * and collides with the server's one-active-workout index.
 */
export async function dropQueuedWrites(workoutId: string): Promise<number> {
  const entries = await queuedWritesFor(workoutId)
  await db.outbox.bulkDelete(entries.map((e) => e.seq!))
  return entries.length
}

/**
 * Whether this workout has never left the device.
 *
 * Deferral is the signal, not the queued op: the drain only ever sees a workout
 * after it finished, which is what releases its writes. So while any of them is
 * still held, nothing about the session has been sent.
 */
export async function isWorkoutUnsent(workoutId: string): Promise<boolean> {
  const held = await db.outbox
    .where('deferredForWorkoutId')
    .equals(workoutId)
    .filter((e) => e.table === 'workouts' && e.rowId === workoutId)
    .count()
  return held > 0
}

/**
 * Releases a finished workout's held writes.
 *
 * Just clears the deferral: the drain re-reads each row, so there is nothing to
 * collapse or rewrite. A row that came and went during the session has no local
 * row left, and the drain drops it.
 */
export async function releaseDeferredWrites(workoutId: string): Promise<number> {
  const held = await db.outbox.where('deferredForWorkoutId').equals(workoutId).toArray()
  for (const entry of held) {
    await db.outbox.update(entry.seq!, { deferredForWorkoutId: undefined })
  }
  return held.length
}

type SyncFields = {
  updatedAt: number
  deletedAt: number | null
  clientRev: number
}

type SyncedStore<T extends SyncFields> = {
  get: (id: string) => Promise<T | undefined>
  update: (id: string, changes: Partial<T>) => Promise<number>
}

export async function patchRow<T extends SyncFields>(
  store: SyncedStore<T>,
  table: string,
  id: string,
  patch: Partial<T>,
): Promise<void> {
  const current = await store.get(id)
  if (!current) return
  await store.update(id, { ...patch, ...touch(current.clientRev) } as Partial<T>)
  await enqueue(table, id)
}

/**
 * Frees deferrals whose workout is no longer being written — a held write is
 * invisible: it never pushes and nothing retries it, so a workout left in that
 * state after a crash would never sync. Runs at boot.
 */
export async function releaseStrandedDeferrals(): Promise<number> {
  const workoutIds = new Set(
    (await db.outbox.toArray())
      .map((e) => e.deferredForWorkoutId)
      .filter((id): id is string => id !== undefined),
  )

  let cleared = 0
  for (const workoutId of workoutIds) {
    // Snapshots don't outlive the session that created them (App clears them at
    // boot), so one here means an edit really is open.
    if (await db.editSnapshots.get(workoutId)) continue
    const workout = await db.workouts.get(workoutId)
    // Still genuinely in progress: the deferral is doing its job.
    if (workout && workout.endedAt === null && workout.deletedAt === null) continue

    // Discarded or gone. Releasing these would push a workout the server never
    // saw and then tombstone it, and the insert would collide with the
    // one-active-workout index on the way through.
    if (!workout || workout.deletedAt !== null) {
      cleared += await dropQueuedWrites(workoutId)
      continue
    }
    cleared += await releaseDeferredWrites(workoutId)
  }
  return cleared
}

/** Drops the queued write for a row, for when the row is removed outright. */
export async function forgetQueuedWrite(table: string, rowId: string): Promise<void> {
  const entry = await db.outbox.where('[table+rowId]').equals([table, rowId]).first()
  if (entry) await db.outbox.delete(entry.seq!)
}

/**
 * Ends any edit session left over from a previous launch, keeping the edits.
 *
 * A snapshot exists so Cancel can restore a workout, which only makes sense while
 * the user is still on that screen — it can't survive being force-quit. But
 * `deferralFor` reads the snapshot as "this workout is being written", so one left
 * behind by a crash held that workout's writes forever, and nothing retried them:
 * the workout looked synced while its sets sat pending on a parent that could
 * never be sent. Dropping the snapshot keeps what's on screen (the local rows are
 * the edited state) and lets releaseStrandedDeferrals free the writes. Runs at boot.
 */
export async function endStaleEditSessions(): Promise<number> {
  const snapshots = await db.editSnapshots.toArray()
  if (snapshots.length === 0) return 0
  await db.editSnapshots.clear()
  return snapshots.length
}

export async function requeueWorkoutSubtree(workoutId: string): Promise<void> {
  const workoutExercises = await db.workoutExercises
    .where('workoutId')
    .equals(workoutId)
    .toArray()
  for (const we of workoutExercises) {
    await enqueue('workoutExercises', we.id)
    for (const set of await db.sets.where('workoutExerciseId').equals(we.id).toArray()) {
      await enqueue('sets', set.id)
    }
  }
}
