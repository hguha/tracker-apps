/**
 * Repository tests against a real (fake) IndexedDB.
 *
 * These cover the paths where a bug would silently corrupt history: pre-fill
 * precedence, PR recomputation after an edit, warmup exclusion, and the outbox
 * recording every mutation.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'

beforeEach(async () => {
  // Reset the owner id first, so a test that switched it can't leak into the
  // next one's seeding. The persisted db-owner marker lives in localStorage and
  // would otherwise survive the database wipe below.
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  // A clean database per test, so ordering can't leak state between them.
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

describe('seeding', () => {
  it('creates the system library', async () => {
    expect(await db.muscles.count()).toBeGreaterThan(25)
    expect(await db.exercises.count()).toBeGreaterThan(90)
    expect(await db.metricDefinitions.count()).toBeGreaterThan(25)
  })

  it('is idempotent, so it can run on every launch', async () => {
    const before = await db.exercises.count()
    await seedIfNeeded()
    expect(await db.exercises.count()).toBe(before)
  })

  it('tags the reverse dumbbell fly to rear delt, not chest', async () => {
    // The spec's motivating example: it must land in shoulder volume.
    const exercise = await db.exercises.get('reverse_dumbbell_fly')
    expect(exercise).toBeDefined()
    const muscle = await db.muscles.get(exercise!.primaryMuscleId)
    expect(muscle?.id).toBe('rear_delt')
    expect(muscle?.region).toBe('shoulders')
  })

  it('finds exercises by alias', async () => {
    const exercises = await repo.listExercises()
    const ohp = exercises.find((e) => e.aliases.includes('ohp'))
    expect(ohp?.name).toBe('Overhead Press')
  })
})

describe('the logging loop', () => {
  it('records a workout, exercise, and completed set', async () => {
    const workoutId = await repo.startWorkout({ title: 'Push A' })
    const workoutExerciseId = await repo.addExerciseToWorkout(
      workoutId,
      'barbell_bench_press',
    )
    const setId = await repo.addSet({
      workoutExerciseId,
      weightKg: 100,
      reps: 5,
    })
    await repo.logSetValues(setId, {})

    const sets = await repo.listSets(workoutExerciseId)
    expect(sets).toHaveLength(1)
    expect(sets[0]!.isCompleted).toBe(true)
    expect(sets[0]!.completedAt).not.toBeNull()
  })

  it('allows only one workout in progress at a time', async () => {
    const first = await repo.startWorkout()
    const active = await repo.getActiveWorkout()
    expect(active?.id).toBe(first)

    await repo.finishWorkout(first)
    expect(await repo.getActiveWorkout()).toBeUndefined()
  })

  it('queues every mutation in the outbox for later sync', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    await repo.addSet({ workoutExerciseId, weightKg: 150, reps: 5 })

    const entries = await db.outbox.orderBy('seq').toArray()
    const tables = entries.map((e) => e.table)
    expect(tables).toContain('workouts')
    expect(tables).toContain('workoutExercises')
    expect(tables).toContain('sets')
    // Order matters: a set can't be applied before the row it belongs to.
    expect(tables.indexOf('workouts')).toBeLessThan(tables.indexOf('sets'))
  })

  it('queues the FULL row on an update, so an upsert passes the server RLS check', async () => {
    // The bug: patchRow enqueued only the changed fields. The push is an upsert,
    // which PostgREST issues as INSERT ... ON CONFLICT DO UPDATE, and Postgres
    // evaluates the INSERT policy's WITH CHECK against the proposed tuple — so a
    // partial payload arrived with user_id absent and RLS rejected it with "new
    // row violates row-level security policy". Editing a workout produced a pile
    // of those; the retry button then succeeded because it re-reads the full row.
    const workoutId = await repo.startWorkout()
    const weId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId: weId, weightKg: 100, reps: 5 })
    await db.outbox.clear()

    // A plain field edit — the case that was failing.
    await repo.updateWorkout(workoutId, { title: 'Renamed' })
    const workoutEntry = (await db.outbox.toArray()).find((e) => e.table === 'workouts')!
    const workoutPayload = workoutEntry.payload as Record<string, unknown>
    expect(workoutPayload.title).toBe('Renamed')
    // The ownership column RLS checks must be present.
    expect(workoutPayload.userId).toBe(LOCAL_USER_ID)
    expect(workoutPayload.id).toBe(workoutId)

    // Chained rows carry the parent key their ownership walk depends on.
    await db.outbox.clear()
    await repo.logSetValues(setId, { reps: 6 })
    const setPayload = (await db.outbox.toArray()).find((e) => e.table === 'sets')!
      .payload as Record<string, unknown>
    expect(setPayload.workoutExerciseId).toBe(weId)
    expect(setPayload.reps).toBe(6)
  })

  it('soft-deletes rather than removing rows, so deletes can sync', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId, weightKg: 100, reps: 5 })

    await repo.deleteSet(setId)
    expect(await repo.listSets(workoutExerciseId)).toHaveLength(0)
    // The row survives as a tombstone.
    expect((await db.sets.get(setId))?.deletedAt).not.toBeNull()

    await repo.restoreSet(setId)
    expect(await repo.listSets(workoutExerciseId)).toHaveLength(1)
  })

  it('inserts a duplicated set directly after its source', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    await repo.addSet({ workoutExerciseId, weightKg: 100, reps: 5 })
    const middle = await repo.addSet({ workoutExerciseId, weightKg: 110, reps: 5 })
    await repo.addSet({ workoutExerciseId, weightKg: 120, reps: 5 })

    const source = await db.sets.get(middle)
    await repo.addSet({
      workoutExerciseId,
      weightKg: 115,
      reps: 3,
      afterPosition: source!.position,
    })

    const sets = await repo.listSets(workoutExerciseId)
    expect(sets.map((s) => s.weightKg)).toEqual([100, 110, 115, 120])
  })
})

describe('append order after a delete', () => {
  it('adds an exercise at the end even when a middle one was removed', async () => {
    // The reported "weirdness": position was the count of *live* rows, so after
    // deleting one the next add reused a position already taken and the new
    // exercise appeared mid-list instead of at the end.
    const workoutId = await repo.startWorkout()
    const first = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const middle = await repo.addExerciseToWorkout(workoutId, 'barbell_back_squat')
    const third = await repo.addExerciseToWorkout(workoutId, 'barbell_row')

    await repo.removeWorkoutExercise(middle)
    const added = await repo.addExerciseToWorkout(workoutId, 'dumbbell_curl')

    const rows = await repo.listWorkoutExercises(workoutId)
    expect(rows.map((r) => r.id)).toEqual([first, third, added])
    // Positions must be distinct, or the order is decided by sort stability
    // rather than by intent — the actual defect, which an id comparison alone
    // can pass by luck.
    const positions = rows.map((r) => r.position)
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('adds a set at the end even when a middle one was removed', async () => {
    const workoutId = await repo.startWorkout()
    const we = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const first = await repo.addSet({ workoutExerciseId: we, weightKg: 100, reps: 5 })
    const middle = await repo.addSet({ workoutExerciseId: we, weightKg: 110, reps: 5 })
    const third = await repo.addSet({ workoutExerciseId: we, weightKg: 120, reps: 5 })

    await repo.deleteSet(middle)
    const added = await repo.addSet({ workoutExerciseId: we, weightKg: 130, reps: 5 })

    const sets = await repo.listSets(we)
    expect(sets.map((s) => s.id)).toEqual([first, third, added])
    const positions = sets.map((s) => s.position)
    expect(new Set(positions).size).toBe(positions.length)
  })
})

describe('placeholder logging semantics (§6.2)', () => {
  it('treats a set with values as performed, with no confirm step', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId })

    // Fresh row: nothing typed, so nothing happened.
    expect((await db.sets.get(setId))?.isCompleted).toBe(false)

    await repo.logSetValues(setId, { weightKg: 150, reps: 5 })
    expect((await db.sets.get(setId))?.isCompleted).toBe(true)
  })

  it('un-logs a set when its values are cleared', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId })

    await repo.logSetValues(setId, { weightKg: 150, reps: 5 })
    await repo.logSetValues(setId, { reps: null })
    expect((await db.sets.get(setId))?.isCompleted).toBe(false)
  })

  it('requires duration or distance for cardio, not reps', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'treadmill_run')
    const setId = await repo.addSet({ workoutExerciseId })

    await repo.logSetValues(setId, { distanceM: 5000 })
    expect((await db.sets.get(setId))?.isCompleted).toBe(true)
  })

  it('discards untouched placeholder rows on finish', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const used = await repo.addSet({ workoutExerciseId })
    await repo.addSet({ workoutExerciseId })
    await repo.addSet({ workoutExerciseId })
    await repo.logSetValues(used, { weightKg: 150, reps: 5 })

    await repo.finishWorkout(workoutId)

    // Only the set that actually happened survives.
    const remaining = await repo.listSets(workoutExerciseId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.weightKg).toBe(150)
  })

  it('drops an exercise that was added but never logged', async () => {
    const workoutId = await repo.startWorkout()
    await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const usedId = await repo.addExerciseToWorkout(workoutId, 'lat_pulldown')
    const setId = await repo.addSet({ workoutExerciseId: usedId })
    await repo.logSetValues(setId, { weightKg: 60, reps: 10 })

    await repo.finishWorkout(workoutId)

    const remaining = await repo.listWorkoutExercises(workoutId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.exerciseId).toBe('lat_pulldown')
  })

  it('copies last time’s numbers via confirmPlaceholder', async () => {
    const first = await repo.startWorkout()
    const firstExercise = await repo.addExerciseToWorkout(first, 'barbell_bench_press')
    const firstSet = await repo.addSet({
      workoutExerciseId: firstExercise,
      weightKg: 100,
      reps: 8,
    })
    await repo.logSetValues(firstSet, {})
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondExercise = await repo.addExerciseToWorkout(second, 'barbell_bench_press')
    const target = await repo.addSet({ workoutExerciseId: secondExercise })

    await repo.confirmPlaceholder(target)
    const set = await db.sets.get(target)
    expect(set).toMatchObject({ weightKg: 100, reps: 8, isCompleted: true })
  })

  it('confirmPlaceholder copies the repeated session’s numbers, not the latest (§7.2)', async () => {
    // An older session at 100×8, then a more recent one at 120×5.
    const older = await repo.startWorkout()
    const olderExercise = await repo.addExerciseToWorkout(older, 'barbell_bench_press')
    const olderSet = await repo.addSet({ workoutExerciseId: olderExercise })
    await repo.logSetValues(olderSet, { weightKg: 100, reps: 8 })
    await repo.finishWorkout(older)

    const newer = await repo.startWorkout()
    const newerExercise = await repo.addExerciseToWorkout(newer, 'barbell_bench_press')
    const newerSet = await repo.addSet({ workoutExerciseId: newerExercise })
    await repo.logSetValues(newerSet, { weightKg: 120, reps: 5 })
    await repo.finishWorkout(newer)

    // Repeating the OLDER session must suggest — and confirm — its numbers,
    // even though a heavier, more recent session exists.
    const repeated = await repo.repeatWorkout(older)
    expect(repeated).not.toBeNull()
    const [target] = await repo.listSetsForWorkout(repeated!.workoutId)

    await repo.confirmPlaceholder(target!.id)
    const set = await db.sets.get(target!.id)
    expect(set).toMatchObject({ weightKg: 100, reps: 8, isCompleted: true })
  })

  it('confirmPlaceholder writes the ghost the row is showing', async () => {
    // The reported bug: on a row whose ghost came from carry-forward, the swipe
    // action did nothing. This re-derived the prefill with a *different* rule
    // than the card renders (`resolvePlaceholders`, which carries values forward
    // from earlier rows), so where the two disagreed it wrote nothing at all.
    // The row now passes what it displays.
    const workoutId = await repo.startWorkout()
    const we = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const target = await repo.addSet({ workoutExerciseId: we })

    await repo.confirmPlaceholder(target, {
      weightKg: 84,
      reps: 6,
      durationSeconds: null,
      distanceM: null,
    })

    expect(await db.sets.get(target)).toMatchObject({
      weightKg: 84,
      reps: 6,
      isCompleted: true,
    })
  })

  it('confirmPlaceholder carries forward within a card when there is no history', async () => {
    // A brand-new exercise: set 1 logged by hand, set 2's ghost can only come
    // from carry-forward. Tapping "Same" on set 2 must still fill it in.
    const workoutId = await repo.startWorkout()
    const we = await repo.addExerciseToWorkout(workoutId, 'barbell_back_squat')
    const first = await repo.addSet({ workoutExerciseId: we })
    await repo.logSetValues(first, { weightKg: 102, reps: 5 })

    const second = await repo.addSet({ workoutExerciseId: we })
    await repo.confirmPlaceholder(second)

    expect(await db.sets.get(second)).toMatchObject({
      weightKg: 102,
      reps: 5,
      isCompleted: true,
    })
  })
})

describe('getPreviousSession — what "Last" means (§6.3)', () => {
  it('is the session before the one being viewed, never a later one', async () => {
    // The reported bug: opening an older workout showed the *newer* session's
    // numbers in the Last column, because lastPerformance caches the three
    // globally-newest sessions regardless of which workout is open.
    const older = await repo.startWorkout({ startedAt: Date.parse('2026-07-01T10:00Z') })
    const olderWe = await repo.addExerciseToWorkout(older, 'deadlift')
    await repo.logSetValues(await repo.addSet({ workoutExerciseId: olderWe }), {
      weightKg: 100,
      reps: 5,
    })
    await repo.finishWorkout(older)

    const middle = await repo.startWorkout({ startedAt: Date.parse('2026-07-08T10:00Z') })
    const middleWe = await repo.addExerciseToWorkout(middle, 'deadlift')
    await repo.logSetValues(await repo.addSet({ workoutExerciseId: middleWe }), {
      weightKg: 120,
      reps: 5,
    })
    await repo.finishWorkout(middle)

    const newest = await repo.startWorkout({ startedAt: Date.parse('2026-07-15T10:00Z') })
    const newestWe = await repo.addExerciseToWorkout(newest, 'deadlift')
    await repo.logSetValues(await repo.addSet({ workoutExerciseId: newestWe }), {
      weightKg: 140,
      reps: 5,
    })
    await repo.finishWorkout(newest)

    // Viewing the middle session: "last" is the older one, not the newest.
    const forMiddle = await repo.getPreviousSession('deadlift', middle)
    expect(forMiddle?.workoutId).toBe(older)
    expect(forMiddle?.sets[0]?.weightKg).toBe(100)

    // Viewing the newest: "last" is the middle one.
    const forNewest = await repo.getPreviousSession('deadlift', newest)
    expect(forNewest?.workoutId).toBe(middle)
    expect(forNewest?.sets[0]?.weightKg).toBe(120)

    // The very first session has nothing before it.
    expect(await repo.getPreviousSession('deadlift', older)).toBeNull()
  })

  it('never returns the workout being viewed, even mid-session', async () => {
    // While logging, the current session is not its own "last time" — that's
    // what made the column echo the row's own numbers back at the user.
    const previous = await repo.startWorkout({
      startedAt: Date.parse('2026-07-01T10:00Z'),
    })
    const previousWe = await repo.addExerciseToWorkout(previous, 'lat_pulldown')
    await repo.logSetValues(await repo.addSet({ workoutExerciseId: previousWe }), {
      weightKg: 60,
      reps: 10,
    })
    await repo.finishWorkout(previous)

    const current = await repo.startWorkout({
      startedAt: Date.parse('2026-07-08T10:00Z'),
    })
    const currentWe = await repo.addExerciseToWorkout(current, 'lat_pulldown')
    await repo.logSetValues(await repo.addSet({ workoutExerciseId: currentWe }), {
      weightKg: 81.6,
      reps: 8,
    })

    const session = await repo.getPreviousSession('lat_pulldown', current)
    expect(session?.workoutId).toBe(previous)
    expect(session?.sets[0]?.weightKg).toBe(60)
  })
})

describe('previewRecords — the PR glow (§6.2)', () => {
  it('reports nothing when no record exists yet', async () => {
    const broken = await repo.previewRecords('deadlift', {
      weightKg: 500,
      reps: 5,
      durationSeconds: null,
      distanceM: null,
    })
    expect(broken).toEqual([])
  })

  it('reports a weight record once one exists to beat', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId, weightKg: 150, reps: 5 })
    await repo.logSetValues(setId, {})
    await repo.finishWorkout(workoutId)

    const broken = await repo.previewRecords('deadlift', {
      weightKg: 160,
      reps: 5,
      durationSeconds: null,
      distanceM: null,
    })
    expect(broken).toContain('max_weight')
  })

  it('writes nothing — it is a preview', async () => {
    const before = await db.personalRecords.count()
    await repo.previewRecords('deadlift', {
      weightKg: 999,
      reps: 5,
      durationSeconds: null,
      distanceM: null,
    })
    expect(await db.personalRecords.count()).toBe(before)
  })

  it('keeps glowing for the set that holds the record, not comparing it to itself', async () => {
    // The bug: records are recomputed the moment a set is logged, so the set that
    // just set the record was then compared against its own value (180 > 180 is
    // false) and the row stopped glowing — a toast with no green row.
    const first = await repo.startWorkout()
    const firstWe = await repo.addExerciseToWorkout(first, 'deadlift')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: firstWe, weightKg: 150, reps: 5 }),
      {},
    )
    await repo.finishWorkout(first)

    // A heavier set: a genuine record.
    const second = await repo.startWorkout()
    const secondWe = await repo.addExerciseToWorkout(second, 'deadlift')
    const prSetId = await repo.addSet({
      workoutExerciseId: secondWe,
      weightKg: 180,
      reps: 5,
    })
    await repo.logSetValues(prSetId, {})

    // Passing the set's own id excludes its own record, so it still glows.
    const withId = await repo.previewRecords('deadlift', (await db.sets.get(prSetId))!)
    expect(withId).toContain('max_weight')
  })

  it('marks nothing on a first-ever exercise, however the sets ramp', async () => {
    // The report: "some exercises that were my first time doing it, it marked a
    // few different sets as PRs". A warmup ramp beat *itself* — 185 cleared 135,
    // 225 cleared 185 — so each rung claimed a record on an exercise with no
    // history at all. Nothing here should glow: there is nothing to beat.
    const workoutId = await repo.startWorkout()
    const we = await repo.addExerciseToWorkout(workoutId, 'barbell_back_squat')

    const setIds: string[] = []
    for (const weightKg of [61, 84, 102]) {
      const setId = await repo.addSet({ workoutExerciseId: we, weightKg, reps: 5 })
      await repo.logSetValues(setId, {})
      setIds.push(setId)
    }

    for (const setId of setIds) {
      const set = (await db.sets.get(setId))!
      expect(await repo.previewRecords('barbell_back_squat', set)).toEqual([])
    }
  })

  it('glows only on the session’s best set, not every set that beats history', async () => {
    // Against a previous best of 150, logging 160 → 170 → 180 lit up all three:
    // each beats history, so each claimed the record while only 180 holds it.
    const first = await repo.startWorkout()
    const firstWe = await repo.addExerciseToWorkout(first, 'deadlift')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: firstWe, weightKg: 150, reps: 5 }),
      {},
    )
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondWe = await repo.addExerciseToWorkout(second, 'deadlift')
    const ids: string[] = []
    for (const weightKg of [160, 170, 180]) {
      const setId = await repo.addSet({ workoutExerciseId: secondWe, weightKg, reps: 5 })
      await repo.logSetValues(setId, {})
      ids.push(setId)
    }

    const glowing = await Promise.all(
      ids.map(async (id) =>
        (await repo.previewRecords('deadlift', (await db.sets.get(id))!)).includes(
          'max_weight',
        ),
      ),
    )
    expect(glowing).toEqual([false, false, true])
  })
})

describe('personal record reporting (§6.4)', () => {
  it('never announces max_volume_session, which grows with every set', async () => {
    // Session volume is a running total, so set 2 always beats set 1's total and
    // set 3 beats set 2's. Reporting that fired a "New personal record" toast on
    // essentially every set of a normal workout.
    const workoutId = await repo.startWorkout()
    const we = await repo.addExerciseToWorkout(workoutId, 'lat_pulldown')

    const reported: string[][] = []
    for (let i = 0; i < 3; i += 1) {
      const setId = await repo.addSet({ workoutExerciseId: we, weightKg: 81.6, reps: 8 })
      reported.push(await repo.logSetValues(setId, {}))
    }

    // Three identical sets announce nothing at all — no record was beaten.
    expect(reported).toEqual([[], [], []])
    // It's still tracked for the detail sheet, just not announced.
    const prs = await repo.listPersonalRecords('lat_pulldown')
    expect(prs.some((pr) => pr.recordType === 'max_volume_session')).toBe(true)
  })

  it('announces nothing on a first-ever ascending exercise', async () => {
    // The toast side of the same bug: an ascending ramp on a brand-new exercise
    // announced a record per rung, because each set beat the running best that
    // the set before it had just written.
    const workoutId = await repo.startWorkout()
    const we = await repo.addExerciseToWorkout(workoutId, 'barbell_back_squat')

    const reported: string[][] = []
    for (const weightKg of [61, 84, 102]) {
      const setId = await repo.addSet({ workoutExerciseId: we, weightKg, reps: 5 })
      reported.push(await repo.logSetValues(setId, {}))
    }

    expect(reported).toEqual([[], [], []])
  })

  it('announces a session’s record once, not once per improving set', async () => {
    const first = await repo.startWorkout()
    const firstWe = await repo.addExerciseToWorkout(first, 'deadlift')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: firstWe, weightKg: 150, reps: 5 }),
      {},
    )
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondWe = await repo.addExerciseToWorkout(second, 'deadlift')
    const reported: string[][] = []
    for (const weightKg of [160, 170, 180]) {
      const setId = await repo.addSet({ workoutExerciseId: secondWe, weightKg, reps: 5 })
      reported.push(await repo.logSetValues(setId, {}))
    }

    // Each set genuinely raises the session's best over history, so each is a
    // real record moment as it happens — but the announcement is about weight
    // only, never a repeat of the same type for a set that improved nothing.
    expect(reported.map((types) => types.includes('max_weight'))).toEqual([
      true,
      true,
      true,
    ])
    // A fourth, lighter set announces nothing.
    const lighter = await repo.addSet({
      workoutExerciseId: secondWe,
      weightKg: 100,
      reps: 5,
    })
    expect(await repo.logSetValues(lighter, {})).toEqual([])
  })

  it('does not announce during a bulk repair, which has no session', async () => {
    const workoutId = await repo.startWorkout()
    const we = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: we, weightKg: 200, reps: 5 }),
      {},
    )
    await repo.finishWorkout(workoutId)

    expect(await repo.refreshPersonalRecords('deadlift')).toEqual([])
  })

  it('still announces a genuine weight record', async () => {
    const first = await repo.startWorkout()
    const firstWe = await repo.addExerciseToWorkout(first, 'deadlift')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: firstWe, weightKg: 150, reps: 5 }),
      {},
    )
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondWe = await repo.addExerciseToWorkout(second, 'deadlift')
    const broken = await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: secondWe, weightKg: 180, reps: 5 }),
      {},
    )
    expect(broken).toContain('max_weight')
  })
})

describe('supersets by drag (§6.4)', () => {
  it('groups two exercises and makes them adjacent', async () => {
    const workoutId = await repo.startWorkout()
    const a = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const middle = await repo.addExerciseToWorkout(workoutId, 'barbell_back_squat')
    const c = await repo.addExerciseToWorkout(workoutId, 'barbell_row')

    // Drag the third card onto the first.
    await repo.supersetExercises(c, a)

    const rows = await repo.listWorkoutExercises(workoutId)
    expect(rows[0]!.id).toBe(a)
    expect(rows[1]!.id).toBe(c)
    expect(rows[2]!.id).toBe(middle)
    expect(rows[0]!.supersetGroup).toBe(rows[1]!.supersetGroup)
    expect(rows[0]!.supersetGroup).not.toBeNull()
  })

  it('extends an existing group rather than starting a new one', async () => {
    const workoutId = await repo.startWorkout()
    const a = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const b = await repo.addExerciseToWorkout(workoutId, 'barbell_row')
    const c = await repo.addExerciseToWorkout(workoutId, 'dumbbell_curl')

    await repo.supersetExercises(b, a)
    await repo.supersetExercises(c, b)

    const rows = await repo.listWorkoutExercises(workoutId)
    const groups = new Set(rows.map((r) => r.supersetGroup))
    expect(groups.size).toBe(1)
    expect([...groups][0]).not.toBeNull()
  })

  it('ungroups the partner when a superset drops to one member', async () => {
    const workoutId = await repo.startWorkout()
    const a = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const b = await repo.addExerciseToWorkout(workoutId, 'barbell_row')
    await repo.supersetExercises(b, a)

    await repo.removeFromSuperset(b)

    const rows = await repo.listWorkoutExercises(workoutId)
    expect(rows.every((r) => r.supersetGroup === null)).toBe(true)
  })

  it('ungroups the partner when the other half is deleted', async () => {
    // The reported bug: deleting one of two supersetted exercises left the other
    // still flagged, so a lone exercise kept the accent rule and the "Superset"
    // badge. Only removeFromSuperset collapsed a group of one; deletion is the
    // other way a group can shrink.
    const workoutId = await repo.startWorkout()
    const a = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const b = await repo.addExerciseToWorkout(workoutId, 'barbell_row')
    await repo.supersetExercises(b, a)

    await repo.removeWorkoutExercise(b)

    const rows = await repo.listWorkoutExercises(workoutId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.supersetGroup).toBeNull()
  })

  it('keeps a three-way group intact when one member is deleted', async () => {
    const workoutId = await repo.startWorkout()
    const a = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const b = await repo.addExerciseToWorkout(workoutId, 'barbell_row')
    const c = await repo.addExerciseToWorkout(workoutId, 'dumbbell_curl')
    await repo.supersetExercises(b, a)
    await repo.supersetExercises(c, b)

    await repo.removeWorkoutExercise(c)

    const rows = await repo.listWorkoutExercises(workoutId)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.supersetGroup !== null)).toBe(true)
  })

  it('ignores a card dropped on itself', async () => {
    const workoutId = await repo.startWorkout()
    const a = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    await repo.supersetExercises(a, a)
    const rows = await repo.listWorkoutExercises(workoutId)
    expect(rows[0]!.supersetGroup).toBeNull()
  })
})

describe('session title signals (§6.7)', () => {
  it('emits one signal per working set with its region and pattern', async () => {
    const workoutId = await repo.startWorkout()
    const benchId = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    for (const reps of [8, 8]) {
      const setId = await repo.addSet({ workoutExerciseId: benchId, weightKg: 100, reps })
      await repo.logSetValues(setId, {})
    }

    const signals = await repo.getSessionTitleSignals(workoutId)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toMatchObject({
      region: 'chest',
      pattern: 'horizontal_push',
    })
  })
})

describe('getBadgeStats', () => {
  it('reports best big-three e1RMs, cardio totals, and variety', async () => {
    // Bench: 100 kg × 5 → Epley e1RM ≈ 116.7 kg, recorded as a PR.
    const w = await repo.startWorkout({ title: 'Full' })
    const bench = await repo.addExerciseToWorkout(w, 'barbell_bench_press')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: bench, weightKg: 100, reps: 5 }),
      {},
    )
    // A cardio interval: 5 km in 25 min.
    const run = await repo.addExerciseToWorkout(w, 'treadmill_run')
    await repo.logSetValues(await repo.addSet({ workoutExerciseId: run }), {
      distanceM: 5000,
      durationSeconds: 1500,
    })
    await repo.finishWorkout(w)

    const stats = await repo.getBadgeStats()
    expect(stats.bestBenchE1rmKg).toBeCloseTo(116.7, 0)
    expect(stats.bestAnyE1rmKg).toBeCloseTo(116.7, 0)
    expect(stats.bestDeadliftE1rmKg).toBe(0) // never trained
    expect(stats.totalCardioMeters).toBe(5000)
    expect(stats.totalCardioSeconds).toBe(1500)
    expect(stats.distinctExercises).toBe(2)
  })

  it('is all zeros for an empty history', async () => {
    const stats = await repo.getBadgeStats()
    expect(stats.bestAnyE1rmKg).toBe(0)
    expect(stats.totalCardioMeters).toBe(0)
    expect(stats.distinctExercises).toBe(0)
  })
})

describe('createTemplatesFromPlan (§13)', () => {
  it('materializes a plan into templates, matching exercises by name', async () => {
    const result = await repo.createTemplatesFromPlan({
      unitWeight: 'lb',
      sessions: [
        {
          name: 'Upper',
          exercises: [
            { name: 'Barbell Bench Press', sets: 3, repLow: 5, repHigh: 8, weight: 225 },
            {
              name: 'Totally Made Up Lift',
              sets: 3,
              repLow: 8,
              repHigh: 12,
              weight: null,
            },
          ],
        },
      ],
    })
    expect(result.templateIds).toHaveLength(1)
    // The unmatched name is reported, not invented.
    expect(result.unmatched).toEqual(['Totally Made Up Lift'])

    const tes = await repo.listTemplateExercises(result.templateIds[0]!)
    expect(tes).toHaveLength(1)
    expect(tes[0]!.exerciseId).toBe('barbell_bench_press')
    expect(tes[0]!.targetRepsLow).toBe(5)
    // 225 lb stored back as kg (~102).
    expect(tes[0]!.targetWeightKg).toBeCloseTo(102, 0)
  })
})

describe('getCoachSummary', () => {
  it('produces a de-identified summary from logged history', async () => {
    const w = await repo.startWorkout({ title: 'Push' })
    const bench = await repo.addExerciseToWorkout(w, 'barbell_bench_press')
    for (const reps of [10, 10]) {
      await repo.logSetValues(
        await repo.addSet({ workoutExerciseId: bench, weightKg: 100, reps }),
        {},
      )
    }
    await repo.finishWorkout(w)

    const summary = await repo.getCoachSummary()
    expect(summary.totalWorkouts).toBe(1)
    expect(summary.exercises[0]!.name).toBe('Barbell Bench Press')
    expect(summary.weeks[0]!.weekOffset).toBe(0)
    // The privacy contract holds end-to-end: nothing identifying serializes.
    const json = JSON.stringify(summary)
    expect(json).not.toMatch(/\d{13}/) // no epoch ms
    expect(json.toLowerCase()).not.toContain('startedat')
  })

  it('returns an empty summary for no history', async () => {
    const summary = await repo.getCoachSummary()
    expect(summary.totalWorkouts).toBe(0)
    expect(summary.exercises).toEqual([])
  })
})

describe('listWorkoutSummaries — batched load', () => {
  it('matches the per-workout builder exactly for a mixed history', async () => {
    // Two sessions of different shapes, so a batching bug (wrong exercise
    // bucketed to the wrong workout, or unsorted sets) would surface as a
    // divergence from the trusted single-workout path.
    const a = await repo.startWorkout({ title: 'Push' })
    const bench = await repo.addExerciseToWorkout(a, 'barbell_bench_press')
    for (const reps of [8, 6]) {
      const id = await repo.addSet({ workoutExerciseId: bench, weightKg: 100, reps })
      await repo.logSetValues(id, {})
    }
    await repo.finishWorkout(a)

    const b = await repo.startWorkout({ title: 'Pull' })
    const row = await repo.addExerciseToWorkout(b, 'lat_pulldown')
    const setId = await repo.addSet({ workoutExerciseId: row, weightKg: 60, reps: 10 })
    await repo.logSetValues(setId, {})
    await repo.finishWorkout(b)

    const batched = await repo.listWorkoutSummaries(100)
    // The trusted reference: build each summary one at a time.
    const oneByOne = await Promise.all(
      batched.map((s) => repo.getWorkoutSummary(s.workout)),
    )

    expect(batched).toHaveLength(2)
    expect(batched).toEqual(oneByOne)
  })

  it('returns an empty list for an empty history without querying', async () => {
    expect(await repo.listWorkoutSummaries(100)).toEqual([])
  })

  it('carries exercise ids so History can filter by a specific lift', async () => {
    const w = await repo.startWorkout({ title: 'Pull' })
    const row = await repo.addExerciseToWorkout(w, 'lat_pulldown')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: row, weightKg: 60, reps: 10 }),
      {},
    )
    await repo.finishWorkout(w)

    const [summary] = await repo.listWorkoutSummaries(100)
    expect(summary!.exerciseIds).toEqual(['lat_pulldown'])
    // Names and ids stay aligned by index, which the exercise picker relies on.
    expect(summary!.exerciseNames).toHaveLength(summary!.exerciseIds.length)
  })

  it('carries per-region working-set counts so Home needs no second scan', async () => {
    const w = await repo.startWorkout({ title: 'Push' })
    const bench = await repo.addExerciseToWorkout(w, 'barbell_bench_press')
    for (const reps of [8, 8, 8]) {
      await repo.logSetValues(
        await repo.addSet({ workoutExerciseId: bench, weightKg: 80, reps }),
        {},
      )
    }
    await repo.finishWorkout(w)

    const [summary] = await repo.listWorkoutSummaries(100)
    // Bench press is a chest lift; three working sets land under chest.
    expect(summary!.workingSetsByRegion.chest).toBe(3)
  })
})

describe('repeating a workout from history (§7.2)', () => {
  it('copies the structure without the numbers', async () => {
    const source = await repo.startWorkout({ title: 'Pull A' })
    const sourceExercise = await repo.addExerciseToWorkout(source, 'lat_pulldown')
    for (const reps of [10, 9]) {
      const setId = await repo.addSet({
        workoutExerciseId: sourceExercise,
        weightKg: 60,
        reps,
      })
      await repo.logSetValues(setId, {})
    }
    await repo.finishWorkout(source)

    const result = await repo.repeatWorkout(source)
    expect(result).not.toBeNull()

    const rows = await repo.listWorkoutExercises(result!.workoutId)
    expect(rows).toHaveLength(1)
    const sets = await repo.listSets(rows[0]!.id)
    expect(sets).toHaveLength(2)
    // Empty rows — nothing is pre-logged.
    expect(sets.every((s) => s.reps === null && !s.isCompleted)).toBe(true)

    // …but the source session's numbers come back as placeholders, so repeating
    // a six-week-old session suggests what was done then (§7.2).
    expect(result!.placeholders[sets[0]!.id]).toMatchObject({ weightKg: 60, reps: 10 })
    expect(result!.placeholders[sets[1]!.id]).toMatchObject({ weightKg: 60, reps: 9 })
  })

  it('creates no template row', async () => {
    const source = await repo.startWorkout({ title: 'Pull A' })
    const sourceExercise = await repo.addExerciseToWorkout(source, 'lat_pulldown')
    const setId = await repo.addSet({
      workoutExerciseId: sourceExercise,
      weightKg: 60,
      reps: 10,
    })
    await repo.logSetValues(setId, {})
    await repo.finishWorkout(source)

    await repo.repeatWorkout(source)
    expect(await repo.listTemplates()).toHaveLength(0)
  })
})

describe('last performance and pre-fill', () => {
  it('pre-fills from the same set index of the previous session', async () => {
    // Session one: 3 sets of increasing weight.
    const first = await repo.startWorkout()
    const firstExercise = await repo.addExerciseToWorkout(first, 'barbell_bench_press')
    for (const [weightKg, reps] of [
      [100, 8],
      [105, 6],
      [110, 5],
    ] as const) {
      const setId = await repo.addSet({
        workoutExerciseId: firstExercise,
        weightKg,
        reps,
      })
      await repo.logSetValues(setId, {})
    }
    await repo.finishWorkout(first)

    // Each index should recall that index's numbers, not a session average.
    expect(await repo.getPrefillForSet('barbell_bench_press', 0)).toMatchObject({
      weightKg: 100,
      reps: 8,
    })
    expect(await repo.getPrefillForSet('barbell_bench_press', 1)).toMatchObject({
      weightKg: 105,
      reps: 6,
    })
    // Beyond what was done last time, fall back to the final set.
    expect(await repo.getPrefillForSet('barbell_bench_press', 5)).toMatchObject({
      weightKg: 110,
      reps: 5,
    })
  })

  it('has nothing to pre-fill for a first-ever exercise', async () => {
    expect(await repo.getPrefillForSet('barbell_bench_press', 0)).toBeNull()
  })

  it('keeps only the last three sessions in the cache', async () => {
    for (let session = 0; session < 5; session += 1) {
      const workoutId = await repo.startWorkout()
      const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
      const setId = await repo.addSet({
        workoutExerciseId,
        weightKg: 100 + session * 5,
        reps: 5,
      })
      await repo.logSetValues(setId, {})
      await repo.finishWorkout(workoutId)
    }

    const cache = await repo.getLastPerformance('deadlift')
    expect(cache?.sessions).toHaveLength(3)
    // Most recent first, so the header reads the latest session.
    expect(cache!.sessions[0]!.sets[0]!.weightKg).toBe(120)
  })
})

describe('personal records', () => {
  it('does not call a first-ever set a PR', async () => {
    // Technically it sets every record, but there was nothing to beat, and
    // badging it would make the very first set of every exercise a celebration.
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId, weightKg: 150, reps: 5 })

    expect(await repo.logSetValues(setId, {})).toEqual([])
    // The records are still stored, they just aren't announced.
    expect(await repo.listPersonalRecords('deadlift')).not.toHaveLength(0)
  })

  it('reports a record once a previous one exists to beat', async () => {
    const first = await repo.startWorkout()
    const firstExercise = await repo.addExerciseToWorkout(first, 'deadlift')
    const firstSet = await repo.addSet({
      workoutExerciseId: firstExercise,
      weightKg: 150,
      reps: 5,
    })
    await repo.logSetValues(firstSet, {})
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondExercise = await repo.addExerciseToWorkout(second, 'deadlift')
    const secondSet = await repo.addSet({
      workoutExerciseId: secondExercise,
      weightKg: 160,
      reps: 5,
    })

    const broken = await repo.logSetValues(secondSet, {})
    expect(broken).toContain('max_weight')
    expect(broken).toContain('max_est_1rm')
  })

  it('removes a record when a past workout is edited downward', async () => {
    // This is the §6.6 requirement: a correction must be able to invalidate a PR,
    // which an incremental "is this better?" check could never do.
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId, weightKg: 200, reps: 5 })
    await repo.logSetValues(setId, {})
    await repo.finishWorkout(workoutId)

    let records = await repo.listPersonalRecords('deadlift')
    expect(records.find((r) => r.recordType === 'max_weight')?.value).toBe(200)

    // Fat-fingered 200 when it was really 100.
    await repo.updateSet(setId, { weightKg: 100 })
    await repo.refreshPersonalRecords('deadlift')

    records = await repo.listPersonalRecords('deadlift')
    expect(records.find((r) => r.recordType === 'max_weight')?.value).toBe(100)
  })

  it('drops records from a deleted workout', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId, weightKg: 200, reps: 5 })
    await repo.logSetValues(setId, {})

    await repo.deleteWorkout(workoutId)
    await repo.refreshPersonalRecords('deadlift')

    expect(await repo.listPersonalRecords('deadlift')).toHaveLength(0)
  })
})

describe('custom exercises', () => {
  it('creates one that flows into the library', async () => {
    const exerciseId = await repo.createExercise({
      name: 'Cable Rear Delt Row',
      primaryMuscleId: 'rear_delt',
      equipment: 'cable',
      movementPattern: 'horizontal_pull',
      trackingType: 'weight_reps',
    })

    const exercises = await repo.listExercises()
    const created = exercises.find((e) => e.id === exerciseId)
    expect(created?.name).toBe('Cable Rear Delt Row')
    // Owned by the user, unlike the seeded rows.
    expect(created?.userId).not.toBeNull()
  })
})

describe('templates', () => {
  it('captures a finished session, targets included', async () => {
    const workoutId = await repo.startWorkout({ title: 'Pull A' })
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'lat_pulldown')
    for (const reps of [10, 9, 8]) {
      const setId = await repo.addSet({ workoutExerciseId, weightKg: 60, reps })
      await repo.logSetValues(setId, {})
    }
    await repo.finishWorkout(workoutId)

    const templateId = await repo.saveWorkoutAsTemplate(workoutId, 'Pull A')
    const rows = await repo.listTemplateExercises(templateId)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      targetSets: 3,
      targetRepsLow: 8,
      targetRepsHigh: 10,
      targetWeightKg: 60,
    })
  })

  it('instantiates as an unchecked checklist', async () => {
    const source = await repo.startWorkout({ title: 'Pull A' })
    const sourceExercise = await repo.addExerciseToWorkout(source, 'lat_pulldown')
    for (const reps of [10, 10, 10]) {
      const setId = await repo.addSet({
        workoutExerciseId: sourceExercise,
        weightKg: 60,
        reps,
      })
      await repo.logSetValues(setId, {})
    }
    await repo.finishWorkout(source)

    const templateId = await repo.saveWorkoutAsTemplate(source, 'Pull A')
    const newWorkoutId = await repo.startWorkoutFromTemplate(templateId)

    const workoutExercises = await repo.listWorkoutExercises(newWorkoutId)
    expect(workoutExercises).toHaveLength(1)

    const sets = await repo.listSets(workoutExercises[0]!.id)
    // The template supplies the shape — three sets — but no values. Numbers
    // arrive as placeholders from history at log time (§6.2), so instantiating
    // a template never pre-records work that hasn't happened.
    expect(sets).toHaveLength(3)
    expect(sets.every((s) => !s.isCompleted)).toBe(true)
    expect(sets.every((s) => s.weightKg === null && s.reps === null)).toBe(true)

    // …and history still supplies what to suggest for the first set.
    expect(await repo.getPrefillForSet('lat_pulldown', 0)).toMatchObject({
      weightKg: 60,
    })
  })

  it('records template provenance for adherence charts', async () => {
    const source = await repo.startWorkout()
    const sourceExercise = await repo.addExerciseToWorkout(source, 'lat_pulldown')
    const setId = await repo.addSet({ workoutExerciseId: sourceExercise })
    await repo.logSetValues(setId, { weightKg: 60, reps: 10 })
    await repo.finishWorkout(source)
    const templateId = await repo.saveWorkoutAsTemplate(source, 'Pull A')

    const newWorkoutId = await repo.startWorkoutFromTemplate(templateId)
    expect((await repo.getWorkout(newWorkoutId))?.templateId).toBe(templateId)
  })
})

describe('empty workouts are never saved (§6.4.1)', () => {
  it('discards a session where nothing was logged', async () => {
    const workoutId = await repo.startWorkout()

    expect(await repo.finishWorkout(workoutId)).toBe('discarded-empty')
    expect(await repo.getWorkout(workoutId)).toBeUndefined()
  })

  it('discards a session with exercises but no logged sets', async () => {
    // The common accident: open a workout, add an exercise, put the phone away.
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    await repo.addSet({ workoutExerciseId })
    await repo.addSet({ workoutExerciseId })

    expect(await repo.finishWorkout(workoutId)).toBe('discarded-empty')
    expect(await repo.getWorkout(workoutId)).toBeUndefined()
  })

  it('keeps a session with even one logged set', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId })
    await repo.logSetValues(setId, { weightKg: 100, reps: 5 })

    expect(await repo.finishWorkout(workoutId)).toBe('saved')
    expect(await repo.getWorkout(workoutId)).toBeDefined()
  })

  it('leaves an empty discarded session out of history', async () => {
    const kept = await repo.startWorkout()
    const keptExercise = await repo.addExerciseToWorkout(kept, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId: keptExercise })
    await repo.logSetValues(setId, { weightKg: 100, reps: 5 })
    await repo.finishWorkout(kept)

    const empty = await repo.startWorkout()
    await repo.finishWorkout(empty)

    const history = await repo.listWorkouts(50)
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe(kept)
  })
})

describe('placeholder resolution (§6.2)', () => {
  it('suggests the matching set index from history', async () => {
    const first = await repo.startWorkout()
    const firstExercise = await repo.addExerciseToWorkout(first, 'barbell_bench_press')
    for (const [weightKg, reps] of [
      [100, 8],
      [100, 7],
    ] as const) {
      const setId = await repo.addSet({
        workoutExerciseId: firstExercise,
        weightKg,
        reps,
      })
      await repo.logSetValues(setId, {})
    }
    await repo.finishWorkout(first)

    // Set 0 of a fresh session suggests set 0 from history.
    const prefill = await repo.getPrefillForSet('barbell_bench_press', 0)
    expect(prefill).toMatchObject({ weightKg: 100, reps: 8 })
  })

  it('carries forward this session when history runs out', async () => {
    // History has 2 sets; a 3rd should suggest what was just done this session
    // rather than going blank at the moment the user is most tired.
    const first = await repo.startWorkout()
    const firstExercise = await repo.addExerciseToWorkout(first, 'barbell_bench_press')
    for (const [weightKg, reps] of [
      [100, 8],
      [100, 7],
    ] as const) {
      const setId = await repo.addSet({
        workoutExerciseId: firstExercise,
        weightKg,
        reps,
      })
      await repo.logSetValues(setId, {})
    }
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondExercise = await repo.addExerciseToWorkout(second, 'barbell_bench_press')
    for (const [weightKg, reps] of [
      [105, 8],
      [105, 6],
    ] as const) {
      const setId = await repo.addSet({
        workoutExerciseId: secondExercise,
        weightKg,
        reps,
      })
      await repo.logSetValues(setId, {})
    }
    const current = await repo.listSets(secondExercise)

    // Index 2 is past the 2 sets of history, so it carries forward set index 1
    // of *this* session (105 × 6).
    const prefill = await repo.getPrefillForSet('barbell_bench_press', 2, current)
    expect(prefill).toMatchObject({ weightKg: 105, reps: 6 })
  })

  it('has no placeholder for a first-ever exercise', async () => {
    const prefill = await repo.getPrefillForSet('deadlift', 0)
    expect(prefill).toBeNull()
  })

  it('addSetWithPlaceholder adds an unlogged row', async () => {
    const first = await repo.startWorkout()
    const firstExercise = await repo.addExerciseToWorkout(first, 'deadlift')
    const seed = await repo.addSet({
      workoutExerciseId: firstExercise,
      weightKg: 150,
      reps: 5,
    })
    await repo.logSetValues(seed, {})
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondExercise = await repo.addExerciseToWorkout(second, 'deadlift')
    const { setId } = await repo.addSetWithPlaceholder(secondExercise, 'deadlift')

    // The suggestion is resolved live in the UI — the added row is still unlogged.
    const set = await db.sets.get(setId)
    expect(set?.isCompleted).toBe(false)
    expect(set?.weightKg).toBeNull()
  })
})

describe('body metrics', () => {
  it('caches bodyweight on the profile for volume math', async () => {
    await repo.addMetricEntry({ definitionId: 'bodyweight', value: 82.5 })
    expect((await repo.getProfile()).bodyweightCacheKg).toBe(82.5)
  })

  it('returns entries newest first', async () => {
    const now = Date.now()
    await repo.addMetricEntry({
      definitionId: 'waist',
      value: 84,
      measuredAt: now - 86400000,
    })
    await repo.addMetricEntry({ definitionId: 'waist', value: 83, measuredAt: now })

    const entries = await repo.listMetricEntries('waist')
    expect(entries[0]!.value).toBe(83)
  })
})

describe('supersets', () => {
  it('groups and ungroups exercises', async () => {
    const workoutId = await repo.startWorkout()
    const a = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const b = await repo.addExerciseToWorkout(workoutId, 'barbell_row')

    await repo.setSupersetGroup([a, b], 1)
    let rows = await repo.listWorkoutExercises(workoutId)
    expect(rows.every((r) => r.supersetGroup === 1)).toBe(true)

    await repo.setSupersetGroup([a, b], null)
    rows = await repo.listWorkoutExercises(workoutId)
    expect(rows.every((r) => r.supersetGroup === null)).toBe(true)
  })
})

describe('cardio', () => {
  it('logs distance and duration without inflating lifting volume', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'treadmill_run')
    const setId = await repo.addSet({
      workoutExerciseId,
      durationSeconds: 1800,
      distanceM: 5000,
    })
    await repo.logSetValues(setId, {})
    await repo.finishWorkout(workoutId)

    const cache = await repo.getLastPerformance('treadmill_run')
    expect(cache?.sessions[0]?.sets[0]).toMatchObject({
      durationSeconds: 1800,
      distanceM: 5000,
    })
    // Cardio carries no volume load, by definition.
    expect(cache?.sessions[0]?.volumeKg).toBe(0)
  })

  it('tracks distance and duration records', async () => {
    const first = await repo.startWorkout()
    const firstExercise = await repo.addExerciseToWorkout(first, 'treadmill_run')
    const firstSet = await repo.addSet({
      workoutExerciseId: firstExercise,
      durationSeconds: 1800,
      distanceM: 5000,
    })
    await repo.logSetValues(firstSet, {})
    await repo.finishWorkout(first)

    // A longer run beats the stored distance record.
    const second = await repo.startWorkout()
    const secondExercise = await repo.addExerciseToWorkout(second, 'treadmill_run')
    const secondSet = await repo.addSet({
      workoutExerciseId: secondExercise,
      durationSeconds: 2400,
      distanceM: 7000,
    })

    const broken = await repo.logSetValues(secondSet, {})
    expect(broken).toContain('max_distance')
    expect(broken).toContain('max_duration')
  })
})

describe('editing a past workout', () => {
  it('applies an edit and refreshes the cached last performance', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId, weightKg: 140, reps: 5 })
    await repo.logSetValues(setId, {})
    await repo.finishWorkout(workoutId)

    // Realized afterward it was actually 145.
    await repo.updateSet(setId, { weightKg: 145 })
    await repo.rebuildLastPerformanceForWorkout(workoutId)

    const cache = await repo.getLastPerformance('deadlift')
    expect(cache?.sessions[0]?.sets[0]?.weightKg).toBe(145)
  })

  it('supports adding a set that was forgotten at the time', async () => {
    const workoutId = await repo.startWorkout()
    const workoutExerciseId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const first = await repo.addSet({ workoutExerciseId, weightKg: 140, reps: 5 })
    await repo.logSetValues(first, {})
    await repo.finishWorkout(workoutId)

    const forgotten = await repo.addSet({ workoutExerciseId, weightKg: 140, reps: 4 })
    await repo.logSetValues(forgotten, {})

    expect(await repo.listSets(workoutExerciseId)).toHaveLength(2)
  })

  it('creates a backdated workout', async () => {
    const lastTuesday = Date.now() - 5 * 86400000
    const workoutId = await repo.startWorkout({ startedAt: lastTuesday })
    expect((await repo.getWorkout(workoutId))?.startedAt).toBe(lastTuesday)
  })
})

describe('exercise notes', () => {
  it('keeps a per-workout note separate from the exercise’s own note', async () => {
    // Two different kinds of note: "felt heavy today" belongs to one session,
    // "seat on 4" belongs to the exercise forever. Folding them together meant a
    // one-off observation followed the exercise around.
    const first = await repo.startWorkout()
    const firstWe = await repo.addExerciseToWorkout(first, 'lat_pulldown')
    await repo.updateWorkoutExercise(firstWe, { notes: 'Felt heavy' })
    await repo.updateExercise('lat_pulldown', { notes: 'Seat on 4' })

    expect((await repo.getWorkoutExercise(firstWe))?.notes).toBe('Felt heavy')

    // A later session starts with no note of its own but keeps the global one.
    const second = await repo.startWorkout()
    const secondWe = await repo.addExerciseToWorkout(second, 'lat_pulldown')
    expect((await repo.getWorkoutExercise(secondWe))?.notes).toBe('')
    expect((await db.exercises.get('lat_pulldown'))?.notes).toBe('Seat on 4')
  })
})

describe('cancelling an edit to a past workout (§6.6)', () => {
  /** A finished single-set workout, ready to edit. */
  async function loggedWorkout() {
    const workoutId = await repo.startWorkout({ title: 'Pull A' })
    const weId = await repo.addExerciseToWorkout(workoutId, 'deadlift')
    const setId = await repo.addSet({ workoutExerciseId: weId, weightKg: 140, reps: 5 })
    await repo.logSetValues(setId, {})
    await repo.finishWorkout(workoutId)
    return { workoutId, weId, setId }
  }

  it('restores values, added rows, and deletions', async () => {
    const { workoutId, weId, setId } = await loggedWorkout()

    await repo.beginWorkoutEdits(workoutId)
    // The three kinds of damage an accidental tap can do.
    await repo.logSetValues(setId, { weightKg: 999 })
    const added = await repo.addSet({ workoutExerciseId: weId, weightKg: 5, reps: 1 })
    const addedExercise = await repo.addExerciseToWorkout(workoutId, 'lat_pulldown')
    await repo.updateWorkout(workoutId, { title: 'Oops' })

    await repo.cancelWorkoutEdits(workoutId)

    expect((await db.sets.get(setId))?.weightKg).toBe(140)
    expect(await db.sets.get(added)).toBeUndefined()
    expect(await db.workoutExercises.get(addedExercise)).toBeUndefined()
    expect((await repo.getWorkout(workoutId))?.title).toBe('Pull A')
    expect(await repo.listWorkoutExercises(workoutId)).toHaveLength(1)
  })

  it('brings back a set deleted during the edit', async () => {
    const { workoutId, weId, setId } = await loggedWorkout()

    await repo.beginWorkoutEdits(workoutId)
    await repo.deleteSet(setId)
    await repo.cancelWorkoutEdits(workoutId)

    expect(await repo.listSets(weId)).toHaveLength(1)
    expect((await db.sets.get(setId))?.deletedAt).toBeNull()
  })

  it('holds edits back from the server until Done, then releases them', async () => {
    const { workoutId, setId } = await loggedWorkout()
    await db.outbox.clear()

    await repo.beginWorkoutEdits(workoutId)
    await repo.logSetValues(setId, { weightKg: 145 })

    // Nothing may push mid-edit, or a cancelled edit would already be published.
    const queued = await db.outbox.toArray()
    expect(queued.length).toBeGreaterThan(0)
    expect(queued.every((e) => e.deferredForWorkoutId === workoutId)).toBe(true)

    await repo.commitWorkoutEdits(workoutId)
    const released = await db.outbox.toArray()
    expect(released.every((e) => e.deferredForWorkoutId === undefined)).toBe(true)
  })

  it('discards the queued writes on cancel, so nothing is ever sent', async () => {
    const { workoutId, setId } = await loggedWorkout()
    await db.outbox.clear()

    await repo.beginWorkoutEdits(workoutId)
    await repo.logSetValues(setId, { weightKg: 145 })
    await repo.cancelWorkoutEdits(workoutId)

    // The server's copy still matches the snapshot, so there is nothing to say.
    expect(await db.outbox.count()).toBe(0)
  })

  it('recomputes records after a cancel, so a reverted PR disappears', async () => {
    const { workoutId, setId } = await loggedWorkout()

    await repo.beginWorkoutEdits(workoutId)
    await repo.logSetValues(setId, { weightKg: 300 })
    expect(
      (await repo.listPersonalRecords('deadlift')).find(
        (pr) => pr.recordType === 'max_weight',
      )?.value,
    ).toBe(300)

    await repo.cancelWorkoutEdits(workoutId)

    expect(
      (await repo.listPersonalRecords('deadlift')).find(
        (pr) => pr.recordType === 'max_weight',
      )?.value,
    ).toBe(140)
  })

  it('keeps the original snapshot if the edit is reopened', async () => {
    const { workoutId, setId } = await loggedWorkout()

    await repo.beginWorkoutEdits(workoutId)
    await repo.logSetValues(setId, { weightKg: 200 })
    // A remount mid-edit must not adopt the half-edited state as the baseline.
    await repo.beginWorkoutEdits(workoutId)
    await repo.cancelWorkoutEdits(workoutId)

    expect((await db.sets.get(setId))?.weightKg).toBe(140)
  })

  it('reports whether an edit is open', async () => {
    const { workoutId } = await loggedWorkout()
    expect(await repo.isEditingWorkout(workoutId)).toBe(false)
    await repo.beginWorkoutEdits(workoutId)
    expect(await repo.isEditingWorkout(workoutId)).toBe(true)
    await repo.commitWorkoutEdits(workoutId)
    expect(await repo.isEditingWorkout(workoutId)).toBe(false)
  })
})

describe('templates (§7)', () => {
  it('creates, edits, and previews a template without touching workouts', async () => {
    const templateId = await repo.createTemplate('Push A')
    await repo.updateTemplate(templateId, { folder: 'PPL' })
    const teId = await repo.addExerciseToTemplate(templateId, 'barbell_bench_press')
    await repo.updateTemplateExercise(teId, {
      targetSets: 3,
      targetRepsLow: 8,
      targetRepsHigh: 10,
      targetWeightKg: 60,
    })

    const preview = await repo.getTemplatePreview(templateId)
    expect(preview?.title).toBe('Push A')
    expect(preview?.exercises).toHaveLength(1)
    expect(preview?.exercises[0]!.detail).toContain('3 × 8-10')
    expect(preview?.totalSets).toBe(3)
  })

  it('instantiating a template seeds planned sets with target-based placeholders', async () => {
    const templateId = await repo.createTemplate('Legs')
    const teId = await repo.addExerciseToTemplate(templateId, 'barbell_back_squat')
    await repo.updateTemplateExercise(teId, {
      targetSets: 2,
      targetRepsLow: 5,
      targetWeightKg: 100,
    })

    const workoutId = await repo.startWorkoutFromTemplate(templateId)
    const [we] = await repo.listWorkoutExercises(workoutId)
    const sets = await repo.listSets(we!.id)
    expect(sets).toHaveLength(2)
    // Planned, not logged — the rows stay ghosts until the user acts.
    expect(sets.every((s) => !s.isCompleted)).toBe(true)

    const overrides = await repo.getPlaceholderOverrides(workoutId)
    expect(overrides[sets[0]!.id]).toMatchObject({ weightKg: 100, reps: 5 })
  })

  it('applies a progression rule at instantiation after a top-of-range session', async () => {
    const templateId = await repo.createTemplate('Push')
    const teId = await repo.addExerciseToTemplate(templateId, 'barbell_bench_press')
    await repo.updateTemplateExercise(teId, {
      targetSets: 2,
      targetRepsLow: 8,
      targetRepsHigh: 10,
      targetWeightKg: 100,
      progression: { kind: 'double', incrementKg: 2.5, maxRpe: 8 },
    })

    // Log a session that hits the top of the range at the template weight.
    const w1 = await repo.startWorkoutFromTemplate(templateId)
    const [we1] = await repo.listWorkoutExercises(w1)
    for (const set of await repo.listSets(we1!.id)) {
      await repo.logSetValues(set.id, { weightKg: 100, reps: 10 })
    }
    await repo.finishWorkout(w1)

    // Next instantiation should seed +2.5 kg, reset to the bottom of the range.
    const w2 = await repo.startWorkoutFromTemplate(templateId)
    const [we2] = await repo.listWorkoutExercises(w2)
    const sets2 = await repo.listSets(we2!.id)
    const overrides = await repo.getPlaceholderOverrides(w2)
    expect(overrides[sets2[0]!.id]).toMatchObject({ weightKg: 102.5, reps: 8 })
  })

  it('holds the progression weight after a session that missed the range', async () => {
    const templateId = await repo.createTemplate('Push')
    const teId = await repo.addExerciseToTemplate(templateId, 'barbell_bench_press')
    await repo.updateTemplateExercise(teId, {
      targetSets: 2,
      targetRepsLow: 8,
      targetRepsHigh: 10,
      targetWeightKg: 100,
      progression: { kind: 'double', incrementKg: 2.5, maxRpe: 8 },
    })

    const w1 = await repo.startWorkoutFromTemplate(templateId)
    const [we1] = await repo.listWorkoutExercises(w1)
    const sets1 = await repo.listSets(we1!.id)
    // Fell short: only 8 reps, below the top of 10.
    await repo.logSetValues(sets1[0]!.id, { weightKg: 100, reps: 8 })
    await repo.logSetValues(sets1[1]!.id, { weightKg: 100, reps: 8 })
    await repo.finishWorkout(w1)

    const w2 = await repo.startWorkoutFromTemplate(templateId)
    const [we2] = await repo.listWorkoutExercises(w2)
    const sets2 = await repo.listSets(we2!.id)
    const overrides = await repo.getPlaceholderOverrides(w2)
    expect(overrides[sets2[0]!.id]).toMatchObject({ weightKg: 100 })
  })

  it('editing a template never rewrites a workout already started from it', async () => {
    const templateId = await repo.createTemplate('Pull')
    await repo.addExerciseToTemplate(templateId, 'barbell_row')
    const workoutId = await repo.startWorkoutFromTemplate(templateId)
    const before = await repo.listWorkoutExercises(workoutId)

    // Add another exercise to the *template* after the workout exists.
    await repo.addExerciseToTemplate(templateId, 'lat_pulldown')

    const after = await repo.listWorkoutExercises(workoutId)
    expect(after.map((r) => r.exerciseId)).toEqual(before.map((r) => r.exerciseId))
  })

  it('a deleted template disappears from the list but its workouts remain', async () => {
    const templateId = await repo.createTemplate('Throwaway')
    await repo.addExerciseToTemplate(templateId, 'deadlift')
    const workoutId = await repo.startWorkoutFromTemplate(templateId)

    await repo.deleteTemplate(templateId)
    expect(await repo.getTemplate(templateId)).toBeUndefined()
    expect((await repo.listTemplates()).some((t) => t.id === templateId)).toBe(false)
    // The workout is untouched.
    expect(await repo.getWorkout(workoutId)).toBeDefined()
  })
})

describe('active user id + local data reset', () => {
  it('stamps writes with the active user id so they pass RLS on sync', async () => {
    setActiveUserId('11111111-1111-1111-1111-111111111111')
    // Re-seed so a profile exists for the new owner.
    await seedIfNeeded()

    const workoutId = await repo.startWorkout()
    const workout = await db.workouts.get(workoutId)
    expect(workout?.userId).toBe('11111111-1111-1111-1111-111111111111')

    const exId = await repo.createExercise({
      name: 'My Lift',
      primaryMuscleId: 'mid_chest',
      equipment: 'barbell',
      movementPattern: 'horizontal_push',
      trackingType: 'weight_reps',
    })
    expect((await db.exercises.get(exId))?.userId).toBe(
      '11111111-1111-1111-1111-111111111111',
    )
  })

  it('claimLocalData re-owns local rows to the new uid and re-enqueues them', async () => {
    const UID = '22222222-2222-2222-2222-222222222222'

    // A device-only user logs a workout, a set, a template, and a custom lift.
    const workoutId = await repo.startWorkout()
    const weId = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    const setId = await repo.addSet({ workoutExerciseId: weId, weightKg: 100, reps: 5 })
    await repo.logSetValues(setId, {})
    const templateId = await repo.createTemplate('Push', null)
    const customExId = await repo.createExercise({
      name: 'My Lift',
      primaryMuscleId: 'mid_chest',
      equipment: 'barbell',
      movementPattern: 'horizontal_push',
      trackingType: 'weight_reps',
    })

    // Everything is owned by the local user.
    expect((await db.workouts.get(workoutId))?.userId).toBe(LOCAL_USER_ID)
    expect((await db.templates.get(templateId))?.userId).toBe(LOCAL_USER_ID)
    expect((await db.exercises.get(customExId))?.userId).toBe(LOCAL_USER_ID)

    // Simulate the upgrade: point the data layer at the new uid, then claim.
    setActiveUserId(UID)
    await db.outbox.clear() // ignore the pre-upgrade queue; test the claim's output
    const claimed = await repo.claimLocalData(UID)
    expect(claimed).toBeGreaterThan(0)

    // Ownership moved.
    expect((await db.workouts.get(workoutId))?.userId).toBe(UID)
    expect((await db.templates.get(templateId))?.userId).toBe(UID)
    expect((await db.exercises.get(customExId))?.userId).toBe(UID)
    // The profile row is now keyed by the uid, and the local one is gone.
    expect(await db.profiles.get(UID)).toBeDefined()
    expect(await db.profiles.get(LOCAL_USER_ID)).toBeUndefined()

    // The chained rows (set, workout_exercise) were re-enqueued for the server.
    const queued = await db.outbox.toArray()
    expect(queued.some((e) => e.table === 'workouts' && e.rowId === workoutId)).toBe(true)
    expect(queued.some((e) => e.table === 'sets' && e.rowId === setId)).toBe(true)
    expect(queued.some((e) => e.table === 'workoutExercises' && e.rowId === weId)).toBe(
      true,
    )
    // A system library row is never re-owned.
    const benchExists = queued.some((e) => e.rowId === 'barbell_bench_press')
    expect(benchExists).toBe(false)
  })

  it('assertDbOwner wipes when a different account owned the local database', async () => {
    // The reported bug: sign out, sign in as someone else, and the first
    // account's workouts showed under the new account's name. IndexedDB reads
    // aren't user-scoped, so nothing filtered them out — and no server policy can
    // help, because reading a cached row never reaches the server.
    const A = '44444444-4444-4444-4444-444444444444'
    const B = '55555555-5555-5555-5555-555555555555'

    setActiveUserId(A)
    await seedIfNeeded()
    expect(await repo.assertDbOwner(A)).toBe(false)
    const workoutId = await repo.startWorkout()
    await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    expect((await repo.listWorkouts()).length).toBe(1)

    // Account B signs in on the same device.
    setActiveUserId(B)
    expect(await repo.assertDbOwner(B)).toBe(true)

    // A's data is gone, not merely hidden.
    expect(await repo.listWorkouts()).toHaveLength(0)
    expect(await db.workouts.count()).toBe(0)
    expect(await db.sets.count()).toBe(0)
    // The shared library survives — it isn't anyone's data.
    expect(await db.exercises.count()).toBeGreaterThan(90)
  })

  it('assertDbOwner keeps data when the same account signs back in', async () => {
    const A = '66666666-6666-6666-6666-666666666666'
    setActiveUserId(A)
    await seedIfNeeded()
    await repo.assertDbOwner(A)
    await repo.startWorkout()

    // Same account, second sign-in: nothing is wiped.
    expect(await repo.assertDbOwner(A)).toBe(false)
    expect((await repo.listWorkouts()).length).toBe(1)
  })

  it('assertDbOwner adopts an unclaimed device-only database instead of wiping it', async () => {
    // A device-only user signing in for the first time must keep their history —
    // claimLocalData is about to re-own it to them on purpose.
    const A = '77777777-7777-7777-7777-777777777777'
    setActiveUserId(LOCAL_USER_ID)
    await seedIfNeeded()
    await repo.startWorkout()

    setActiveUserId(A)
    expect(await repo.assertDbOwner(A)).toBe(false)
    expect((await repo.listWorkouts()).length).toBe(1)
  })

  it('claimLocalData does not erase a goal the account already has', async () => {
    // The bug: a device-only profile's empty trainingGoal/heightCm overwrote the
    // values the user had just entered during onboarding on the real account.
    const UID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    setActiveUserId(UID)
    await seedIfNeeded()
    await repo.updateProfile({
      trainingGoal: 'squat 405',
      heightCm: 180,
      onboardedAt: 1234,
    })

    // A leftover device-only profile exists with nothing set.
    setActiveUserId(LOCAL_USER_ID)
    await seedIfNeeded()

    setActiveUserId(UID)
    await repo.claimLocalData(UID)

    const profile = await repo.getProfile()
    expect(profile.trainingGoal).toBe('squat 405')
    expect(profile.heightCm).toBe(180)
    expect(profile.onboardedAt).toBe(1234)
  })

  it('onboardedAt lives on the profile, so it syncs instead of being per-device', async () => {
    // Tracked in localStorage before, which meant signing in on a phone and then
    // a laptop ran first-run setup twice.
    const UID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    setActiveUserId(UID)
    await seedIfNeeded()
    expect((await repo.getProfile()).onboardedAt).toBeNull()

    await repo.updateProfile({ onboardedAt: Date.now() })
    expect((await repo.getProfile()).onboardedAt).not.toBeNull()

    // It's queued for the server like any other profile field, which is what
    // carries it to the second device.
    const queued = await db.outbox.toArray()
    const payload = queued.find((e) => e.table === 'profiles')?.payload as
      Record<string, unknown> | undefined
    expect(payload?.onboardedAt).toEqual(expect.any(Number))
  })

  it('claimLocalData is a no-op for the local id and when there is nothing to claim', async () => {
    expect(await repo.claimLocalData(LOCAL_USER_ID)).toBe(0)
  })

  it('purgeEmptyWorkouts removes finished sessions with no completed set', async () => {
    // A real session with logged work.
    const realId = await repo.startWorkout()
    const weId = await repo.addExerciseToWorkout(realId, 'barbell_bench_press')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: weId, weightKg: 100, reps: 5 }),
      {},
    )
    await repo.finishWorkout(realId)

    // An empty finished session, as a pull from an older build would produce.
    // (finishWorkout would have discarded it, so write the end directly.)
    const emptyId = await repo.startWorkout()
    await repo.addExerciseToWorkout(emptyId, 'deadlift')
    await repo.updateWorkout(emptyId, { endedAt: Date.now() })

    // An in-progress session must never be touched.
    const activeId = await repo.startWorkout()

    const removed = await repo.purgeEmptyWorkouts()
    expect(removed).toBe(1)
    expect((await db.workouts.get(emptyId))?.deletedAt).not.toBeNull()
    expect((await db.workouts.get(realId))?.deletedAt).toBeNull()
    expect((await db.workouts.get(activeId))?.deletedAt).toBeNull()
  })

  it('deleteAllTrainingData tombstones everything through the outbox so deletes sync', async () => {
    const workoutId = await repo.startWorkout()
    const weId = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: weId, weightKg: 100, reps: 5 }),
      {},
    )
    await repo.finishWorkout(workoutId)
    const templateId = await repo.createTemplate('Test Push', null)
    const customExId = await repo.createExercise({
      name: 'Fake Lift',
      primaryMuscleId: 'mid_chest',
      equipment: 'barbell',
      movementPattern: 'horizontal_push',
      trackingType: 'weight_reps',
    })

    await db.outbox.clear() // isolate the deletes' own queue entries
    const counts = await repo.deleteAllTrainingData()

    expect(counts.workouts).toBe(1)
    expect(counts.templates).toBe(1)
    expect(counts.customExercises).toBe(1)

    // Tombstoned, not hard-deleted — that's what lets the delete replicate.
    expect((await db.workouts.get(workoutId))?.deletedAt).not.toBeNull()
    expect((await db.templates.get(templateId))?.deletedAt).not.toBeNull()
    expect((await db.exercises.get(customExId))?.deletedAt).not.toBeNull()
    // Gone from the read paths.
    expect(await repo.listTemplates()).toHaveLength(0)
    expect((await repo.listWorkouts()).some((w) => w.id === workoutId)).toBe(false)

    // Every deletion is queued for the server — the whole point.
    const queued = await db.outbox.toArray()
    expect(queued.some((e) => e.table === 'workouts' && e.rowId === workoutId)).toBe(true)
    expect(queued.some((e) => e.table === 'templates' && e.rowId === templateId)).toBe(
      true,
    )
    expect(queued.some((e) => e.table === 'exercises' && e.rowId === customExId)).toBe(
      true,
    )

    // The system library survives — it isn't user data.
    expect(await db.exercises.get('barbell_bench_press')).toBeDefined()
    expect((await db.exercises.get('barbell_bench_press'))?.deletedAt).toBeNull()
  })

  it('clearLocalData wipes training data and queues but keeps the system library', async () => {
    const workoutId = await repo.startWorkout()
    const weId = await repo.addExerciseToWorkout(workoutId, 'barbell_bench_press')
    await repo.logSetValues(
      await repo.addSet({ workoutExerciseId: weId, weightKg: 100, reps: 5 }),
      {},
    )
    await repo.createExercise({
      name: 'Custom Move',
      primaryMuscleId: 'mid_chest',
      equipment: 'dumbbell',
      movementPattern: 'isolation',
      trackingType: 'weight_reps',
    })

    const systemBefore = (await db.exercises.toArray()).filter(
      (e) => e.userId === null,
    ).length
    expect(systemBefore).toBeGreaterThan(100)

    await repo.clearLocalData()

    expect(await db.workouts.count()).toBe(0)
    expect(await db.sets.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.deadLetter.count()).toBe(0)
    expect(await db.syncState.count()).toBe(0)
    // Custom exercise gone, system library intact.
    expect((await db.exercises.toArray()).every((e) => e.userId === null)).toBe(true)
    expect((await db.exercises.toArray()).length).toBe(systemBefore)
  })
})
