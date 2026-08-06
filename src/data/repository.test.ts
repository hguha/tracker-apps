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
  // next one's seeding.
  setActiveUserId(LOCAL_USER_ID)
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
    const secondExercise = await repo.addExerciseToWorkout(
      second,
      'barbell_bench_press',
    )
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
    for (const [weightKg, reps] of [[100, 8], [105, 6], [110, 5]] as const) {
      const setId = await repo.addSet({ workoutExerciseId: firstExercise, weightKg, reps })
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
      const setId = await repo.addSet({ workoutExerciseId: sourceExercise, weightKg: 60, reps })
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
    for (const [weightKg, reps] of [[100, 8], [100, 7]] as const) {
      const setId = await repo.addSet({ workoutExerciseId: firstExercise, weightKg, reps })
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
    for (const [weightKg, reps] of [[100, 8], [100, 7]] as const) {
      const setId = await repo.addSet({ workoutExerciseId: firstExercise, weightKg, reps })
      await repo.logSetValues(setId, {})
    }
    await repo.finishWorkout(first)

    const second = await repo.startWorkout()
    const secondExercise = await repo.addExerciseToWorkout(second, 'barbell_bench_press')
    for (const [weightKg, reps] of [[105, 8], [105, 6]] as const) {
      const setId = await repo.addSet({ workoutExerciseId: secondExercise, weightKg, reps })
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
    const seed = await repo.addSet({ workoutExerciseId: firstExercise, weightKg: 150, reps: 5 })
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
    await repo.addMetricEntry({ definitionId: 'waist', value: 84, measuredAt: now - 86400000 })
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

    const systemBefore = (await db.exercises.toArray()).filter((e) => e.userId === null).length
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
