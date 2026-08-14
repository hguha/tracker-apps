// The durable write queue and the shared row-write helpers every domain module
// builds on: enqueue, the in-progress-workout deferral, and the finish/discard
// release logic that decides what actually reaches the server (§5.5).

import { type OutboxEntry, db, touch } from '@/db/database'

export function newId(): string {
  // randomUUID is only defined in a secure context; dev over http://<lan-ip>
  // (phone-on-wifi testing) isn't one, so fall back rather than throw on every write.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'id-' + crypto.getRandomValues(new Uint32Array(4)).join('-')
}

export async function enqueue(
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
    // Hold this write back if it belongs to a session still in progress (§5.5).
    ...(await deferralFor(table, rowId, payload)),
  })
}

// Exported for the sync engine's retry path, which re-queues rows directly and
// must not hand a live session's writes back to the drain undeferred.

export async function deferralFor(
  table: string,
  rowId: string,
  payload: object,
): Promise<{ deferredForWorkoutId?: string }> {
  let workoutId: string | undefined

  if (table === 'workouts') {
    workoutId = rowId
  } else if (table === 'workoutExercises') {
    workoutId =
      (payload as { workoutId?: string }).workoutId ??
      (await db.workoutExercises.get(rowId))?.workoutId
  } else if (table === 'sets') {
    const workoutExerciseId =
      (payload as { workoutExerciseId?: string }).workoutExerciseId ??
      (await db.sets.get(rowId))?.workoutExerciseId
    if (workoutExerciseId) {
      workoutId = (await db.workoutExercises.get(workoutExerciseId))?.workoutId
    }
  }

  if (!workoutId) return {}

  // A workout open for editing holds its writes too, so a cancelled edit never publishes (§6.6).
  if ((await db.editSnapshots.get(workoutId)) !== undefined) {
    return { deferredForWorkoutId: workoutId }
  }

  const workout = await db.workouts.get(workoutId)
  if (!workout || workout.endedAt !== null || workout.deletedAt !== null) return {}
  return { deferredForWorkoutId: workoutId }
}

// The stores a deferred write can belong to, for re-reading a row at release time.

const DEFERRABLE_STORES = {
  workouts: db.workouts,
  workoutExercises: db.workoutExercises,
  sets: db.sets,
} as const

async function currentRowFor(
  table: string,
  rowId: string,
): Promise<{ deletedAt: number | null; clientRev: number } | undefined> {
  const store = DEFERRABLE_STORES[table as keyof typeof DEFERRABLE_STORES]
  if (!store) return undefined
  return store.get(rowId) as Promise<
    { deletedAt: number | null; clientRev: number } | undefined
  >
}

/** Every outbox entry belonging to a workout, its exercises, and their sets. */

async function queuedWritesFor(workoutId: string): Promise<OutboxEntry[]> {
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
 * For a discarded session that never reached the server, an insert followed by a
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
 * still held, nothing about the session has been sent. (Checking for a queued
 * `insert` instead would misread a discard-then-undo, which re-queues as `update`.)
 */

export async function isWorkoutUnsent(workoutId: string): Promise<boolean> {
  const entries = await db.outbox.where('rowId').equals(workoutId).toArray()
  return entries.some(
    (e) => e.table === 'workouts' && e.deferredForWorkoutId === workoutId,
  )
}

/**
 * Releases a finished workout's held writes, collapsing them first.
 *
 * Two things made the naive version wrong. A payload is frozen at enqueue time,
 * so the `workouts` insert captured while the session was live still claimed
 * `endedAt: null` — and the server's partial unique index on "one active workout"
 * rejected it permanently, which dead-lettered the workout and quarantined every
 * exercise and set under it. And a placeholder set that was never filled in queued
 * both an insert and a tombstone, so rows that never held data still made two
 * round trips each.
 *
 * Re-reading each row at release time fixes both: one entry per row, carrying what
 * the row actually says now, and nothing at all for rows that came and went.
 */

export async function releaseDeferredWrites(workoutId: string): Promise<number> {
  const held = await db.outbox.where('deferredForWorkoutId').equals(workoutId).toArray()
  if (held.length === 0) return 0

  const groups = new Map<string, OutboxEntry[]>()
  for (const entry of [...held].sort((a, b) => a.seq! - b.seq!)) {
    const key = `${entry.table}:${entry.rowId}`
    const list = groups.get(key)
    if (list) list.push(entry)
    else groups.set(key, [entry])
  }

  let released = 0
  for (const entries of groups.values()) {
    const first = entries[0]!
    const current = await currentRowFor(first.table, first.rowId)
    const isNew = entries.some((e) => e.op === 'insert')

    // Gone, or tombstoned before the server ever saw it: say nothing.
    if (current === undefined || (isNew && current.deletedAt !== null)) {
      await db.outbox.bulkDelete(entries.map((e) => e.seq!))
      continue
    }

    // Keep the earliest entry so parents still precede their children, but give it
    // the row as it stands now rather than as it stood mid-session.
    await db.outbox.update(first.seq!, {
      op: isNew ? 'insert' : 'update',
      payload: current as object,
      clientRev: current.clientRev,
      deferredForWorkoutId: undefined,
    })
    const superseded = entries.slice(1).map((e) => e.seq!)
    if (superseded.length > 0) await db.outbox.bulkDelete(superseded)
    released += 1
  }
  return released
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
  const next = { ...patch, ...touch(current.clientRev) } as Partial<T>
  await store.update(id, next)
  // Enqueue the FULL row, not just changed fields, or the upsert's RLS WITH CHECK rejects the partial tuple.
  await enqueue(table, 'update', id, { ...current, ...next }, current.clientRev + 1)
}

// ----- profile -----

export async function releaseStrandedDeferrals(): Promise<number> {
  const held = await db.outbox.toArray()
  const workoutIds = new Set(
    held
      .map((e) => e.deferredForWorkoutId)
      .filter((id): id is string => id !== undefined),
  )

  let cleared = 0
  for (const workoutId of workoutIds) {
    if (await db.editSnapshots.get(workoutId)) continue
    const workout = await db.workouts.get(workoutId)
    // Still genuinely in progress: the deferral is doing its job.
    if (workout && workout.endedAt === null && workout.deletedAt === null) continue

    // Discarded or gone. Releasing these would push a frozen `endedAt: null`
    // insert and resurrect the workout server-side as the one active session,
    // which then collides with every session after it.
    if (!workout || workout.deletedAt !== null) {
      cleared += await dropQueuedWrites(workoutId)
      continue
    }
    cleared += await releaseDeferredWrites(workoutId)
  }
  return cleared
}

// Whether an open edit has actually changed anything. The writes it holds back
// ARE the edit, so an empty held queue means leaving costs nothing and needs no
// "you'll lose this" prompt.

export async function requeueWorkoutSubtree(workoutId: string): Promise<void> {
  const workoutExercises = await db.workoutExercises
    .where('workoutId')
    .equals(workoutId)
    .toArray()
  for (const we of workoutExercises) {
    await enqueue('workoutExercises', 'update', we.id, we, we.clientRev)
    for (const set of await db.sets.where('workoutExerciseId').equals(we.id).toArray()) {
      await enqueue('sets', 'update', set.id, set, set.clientRev)
    }
  }
}

/**
 * Re-queues the parent of any pending chained write whose parent isn't already
 * queued, reading it from the local row. Heals a set (or workout-exercise) whose
 * server parent went missing — dead-lettered then purged, say — so it FK-fails
 * forever with nothing to retry against. Idempotent: the parent upserts, and an
 * already-synced parent is a harmless no-op. Returns how many parents it added.
 */
export async function reenqueueOrphanedParents(): Promise<number> {
  const queued = new Set(
    (await db.outbox.toArray()).map((e) => `${e.table}:${e.rowId}`),
  )
  let repaired = 0

  for (const entry of await db.outbox.where('table').equals('sets').toArray()) {
    const weId =
      (entry.payload as { workoutExerciseId?: string }).workoutExerciseId ??
      (await db.sets.get(entry.rowId))?.workoutExerciseId
    if (!weId || queued.has(`workoutExercises:${weId}`)) continue
    const we = await db.workoutExercises.get(weId)
    if (!we || we.deletedAt !== null) continue
    await enqueue('workoutExercises', 'update', we.id, we, we.clientRev)
    queued.add(`workoutExercises:${weId}`)
    repaired += 1
  }

  // Re-read: a workout_exercise just re-queued above needs its workout too.
  for (const entry of await db.outbox.where('table').equals('workoutExercises').toArray()) {
    const workoutId =
      (entry.payload as { workoutId?: string }).workoutId ??
      (await db.workoutExercises.get(entry.rowId))?.workoutId
    if (!workoutId || queued.has(`workouts:${workoutId}`)) continue
    const workout = await db.workouts.get(workoutId)
    if (!workout || workout.deletedAt !== null) continue
    await enqueue('workouts', 'update', workout.id, workout, workout.clientRev)
    queued.add(`workouts:${workoutId}`)
    repaired += 1
  }
  return repaired
}
