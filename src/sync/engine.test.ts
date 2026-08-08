/**
 * Sync engine tests (§14.1).
 *
 * Covers the outbox contract against the mock backend: offline queueing, replay
 * idempotency, permanent-vs-transient classification, poison-entry
 * dead-lettering, ordered drain, tombstone propagation, and the pending-write
 * guard on pull.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { seedIfNeeded } from '@/db/seed'
import * as repo from '@/data/repository'
import { SyncEngine } from './engine'
import { MockBackend } from './mockBackend'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await seedIfNeeded()
  // Seeding enqueues nothing for system rows, but a clean outbox is clearer.
  await db.outbox.clear()
  await db.deadLetter.clear()
  await db.syncState.clear()
})

describe('outbox drain', () => {
  it('pushes queued writes and empties the outbox', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    const workoutId = await repo.startWorkout()
    const weId = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const setId = await repo.addSet({ workoutExerciseId: weId, weightKg: 100, reps: 5 })
    await repo.logSetValues(setId, {})

    expect(await db.outbox.count()).toBeGreaterThan(0)

    const result = await engine.drain()

    expect(result.stoppedBecause).toBeNull()
    expect(await db.outbox.count()).toBe(0)
    expect(result.pushed).toBeGreaterThan(0)
    // The workout row reached the server.
    expect(backend.get('workouts', workoutId)).toBeDefined()
  })

  it('drains in seq order, so a set never precedes its workout_exercise', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    const workoutId = await repo.startWorkout()
    const weId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    await repo.addSet({ workoutExerciseId: weId, weightKg: 200, reps: 3 })

    await engine.drain()

    const order = backend.pushed.map((p) => p.table)
    expect(order.indexOf('workouts')).toBeLessThan(order.indexOf('workoutExercises'))
    expect(order.indexOf('workoutExercises')).toBeLessThan(order.indexOf('sets'))
  })

  it('replay is idempotent — draining twice leaves one server row', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    const workoutId = await repo.startWorkout()
    await engine.drain()

    // Re-enqueue the same insert (as a replay would) and drain again.
    await db.outbox.add({
      table: 'workouts',
      op: 'insert',
      rowId: workoutId,
      payload: { id: workoutId, title: 'again' },
      clientRev: 1,
      queuedAt: Date.now(),
      attempts: 0,
    })
    await engine.drain()

    expect(backend.count('workouts')).toBe(1)
  })
})

describe('failure classification (§5.5)', () => {
  it('dead-letters a permanent failure and keeps draining the rest', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    // First push is poison, the rest succeed.
    backend.forceNext({ status: 'permanent', error: 'bad payload' })

    const workoutId = await repo.startWorkout()
    await repo.addExerciseToWorkout(workoutId, 'deadlift')

    const result = await engine.drain()

    expect(result.deadLettered).toBe(1)
    expect(await db.deadLetter.count()).toBe(1)
    // The poison entry didn't block the queue — everything else drained.
    expect(await db.outbox.count()).toBe(0)
    const dead = await db.deadLetter.toArray()
    expect(dead[0]!.error).toBe('bad payload')
  })

  it('retryDeadLettered requeues failed writes so a later drain can push them', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    // A write fails permanently (e.g. an out-of-date server) and is dead-lettered.
    backend.forceNext({ status: 'permanent', error: 'column does not exist' })
    const workoutId = await repo.startWorkout()
    await engine.drain()
    expect(await db.deadLetter.count()).toBe(1)
    expect(await db.outbox.count()).toBe(0)

    // The root cause is fixed; the user hits "retry". The entry moves back to the
    // outbox and the next drain (server now healthy) pushes it.
    const requeued = await engine.retryDeadLettered()
    expect(requeued).toBe(1)
    expect(await db.deadLetter.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)

    const result = await engine.drain()
    expect(result.pushed).toBe(1)
    expect(await db.outbox.count()).toBe(0)
    expect(
      backend.pushed.some((p) => p.table === 'workouts' && p.rowId === workoutId),
    ).toBe(true)
  })

  it('stops and backs off on a transient failure, preserving order', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    backend.forceNext({ status: 'transient', error: '503' })
    await repo.startWorkout()
    const before = await db.outbox.count()

    const result = await engine.drain()

    expect(result.stoppedBecause).toBe('transient')
    // Nothing dead-lettered; the head entry stays, with a scheduled retry.
    expect(await db.outbox.count()).toBe(before)
    const head = await db.outbox.orderBy('seq').first()
    expect(head!.attempts).toBe(1)
    expect(head!.nextAttemptAt).toBeGreaterThan(Date.now())
  })

  it('retries a transient failure once the backoff elapses', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    backend.forceNext({ status: 'transient', error: 'network' })
    await repo.startWorkout()

    // First drain fails and schedules a retry in the future.
    await engine.drain()
    expect(await db.outbox.count()).toBe(1)

    // Simulate time passing well past the backoff; now it succeeds.
    const result = await engine.drain(Date.now() + 10 * 60_000)
    expect(result.stoppedBecause).toBeNull()
    expect(await db.outbox.count()).toBe(0)
  })

  it('pauses (does not dead-letter) on an auth failure', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    backend.forceNext({ status: 'auth', error: '401' })
    await repo.startWorkout()

    const result = await engine.drain()
    expect(result.stoppedBecause).toBe('auth')
    expect(await db.deadLetter.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})

describe('delta pull (§5.5)', () => {
  it('applies a server row that has no local pending write', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    // Another device created a custom exercise; it arrives on pull.
    backend.seed('exercises', {
      id: 'remote-ex-1',
      userId: 'local-user',
      name: 'Remote Lift',
      primaryMuscleId: 'mid_chest',
      secondaryMuscles: [],
      aliases: [],
      equipment: 'barbell',
      movementPattern: 'horizontal_push',
      trackingType: 'weight_reps',
      isUnilateral: false,
      bodyweightFactor: null,
      isKeyLift: false,
      notes: '',
      defaultRestSeconds: null,
      isArchived: false,
      createdAt: 1,
      updatedAt: 1000,
      deletedAt: null,
      clientRev: 1,
    })

    await engine.pull()
    expect(await db.exercises.get('remote-ex-1')).toBeDefined()
  })

  it('a local pending write wins over a server row until it drains', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    // Local edit to the profile, still queued.
    await repo.updateProfile({ displayName: 'Local Name' })

    // Server has a competing older value for the same row.
    backend.seed('profiles', {
      id: 'local-user',
      displayName: 'Server Name',
      updatedAt: 500,
    })

    await engine.pull()
    // The pending local write held — the pull didn't clobber it.
    expect((await repo.getProfile()).displayName).toBe('Local Name')
  })

  it('backfills profile columns a server row predates, so the client never sees undefined', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    // A server profile from before the goal/avatar columns existed. It's newer
    // than local (higher updatedAt) so the pull applies it.
    backend.seed('profiles', {
      id: 'local-user',
      displayName: 'Server Name',
      updatedAt: Date.now() + 10_000,
    })

    await engine.pull()
    const profile = await db.profiles.get('local-user')
    // Missing columns are defaulted, not undefined — this is what stopped the
    // Home ring rendering "/NaN".
    expect(profile?.weeklyWorkoutGoal).toBe(4)
    expect(profile?.showAvatar).toBe(false)
    // Coach-personalization columns default too, so getCoachSummary never reads
    // undefined off a pre-migration server row.
    expect(profile?.heightCm).toBeNull()
    expect(profile?.trainingGoal).toBe('')
  })

  it('propagates a tombstone — a deleted row stays filtered out', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    // A workout exists locally, then the server reports it deleted.
    const workoutId = await repo.startWorkout()
    await engine.drain()

    const stored = await db.workouts.get(workoutId)
    backend.seed('workouts', {
      ...stored,
      deletedAt: 9999,
      updatedAt: 9999,
    })

    await engine.pull()
    // getWorkout filters tombstones, so it's gone from the read path.
    expect(await repo.getWorkout(workoutId)).toBeUndefined()
  })

  it('advances the high-water mark so a second pull re-fetches nothing', async () => {
    const backend = new MockBackend()
    const engine = new SyncEngine(backend)

    backend.seed('exercises', {
      id: 'remote-ex-2',
      userId: null,
      name: 'X',
      primaryMuscleId: 'mid_chest',
      secondaryMuscles: [],
      aliases: [],
      equipment: 'barbell',
      movementPattern: 'isolation',
      trackingType: 'weight_reps',
      isUnilateral: false,
      bodyweightFactor: null,
      isKeyLift: false,
      notes: '',
      defaultRestSeconds: null,
      isArchived: false,
      createdAt: 1,
      updatedAt: 2000,
      deletedAt: null,
      clientRev: 1,
    })

    const first = await engine.pull()
    expect(first.applied).toBeGreaterThan(0)
    const second = await engine.pull()
    expect(second.applied).toBe(0)
  })
})
