/**
 * Schema upgrade tests.
 *
 * Every other test opens a fresh database, which lands directly on the current
 * version and never runs an upgrade hook. That leaves the riskiest code in the
 * file untested: a hook that misreads the old shape corrupts every exercise on a
 * real device and there is no second chance.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db, WorkoutDatabase } from '@/db/database'

const NAME = 'upgrade-test'

// The v7 schema, verbatim, so the fixture is written the way a real device holds it.
function openAtV7(): Dexie {
  const old = new Dexie(NAME)
  old.version(2).stores({
    profiles: 'id',
    muscles: 'id, region, userId',
    exercises: 'id, name, primaryMuscleId, movementPattern, equipment, userId, isKeyLift',
    workouts: 'id, startedAt, endedAt, templateId',
    workoutExercises: 'id, workoutId, exerciseId, [workoutId+position]',
    sets: 'id, workoutExerciseId, [workoutExerciseId+position], completedAt',
    templates: 'id, name, folder, lastUsedAt',
    templateExercises: 'id, templateId, [templateId+position]',
    personalRecords: 'id, exerciseId, [exerciseId+recordType], achievedAt',
    metricDefinitions: 'id, key, category',
    metricEntries: 'id, definitionId, [definitionId+measuredAt], measuredAt',
    lastPerformance: 'exerciseId',
    outbox: '++seq, table, rowId',
    syncState: 'table',
    placeholderOverrides: 'workoutId',
  })
  old.version(3).stores({ deadLetter: '++seq, table, rowId' })
  old.version(4).stores({ outbox: '++seq, table, rowId, deferredForWorkoutId' })
  old.version(5).stores({ editSnapshots: 'workoutId' })
  old.version(6).stores({
    exercises: 'id, name, primaryMuscleId, movementPattern, userId, isKeyLift',
    workoutExercises: 'id, workoutId, exerciseId, [workoutId+position]',
    personalRecords:
      'id, exerciseId, [exerciseId+equipment], [exerciseId+equipment+recordType], achievedAt',
    lastPerformance: null,
  })
  old.version(7).stores({ lastPerformance: 'id, exerciseId' })
  return old
}

beforeEach(async () => {
  await db.delete()
  await Dexie.delete(NAME)
})

describe('v8 — region replaces the muscles table', () => {
  it('backfills each exercise from the muscle it pointed at, then drops the table', async () => {
    const old = openAtV7()
    await old.open()
    await old.table('muscles').bulkPut([
      { id: 'rear_delt', userId: null, name: 'Rear Delt', region: 'shoulders' },
      { id: 'mid_chest', userId: null, name: 'Mid Chest', region: 'chest' },
      { id: 'cardiovascular', userId: null, name: 'Cardiovascular', region: 'cardio' },
    ])
    await old.table('exercises').bulkPut([
      { id: 'reverse_fly', name: 'Reverse Fly', primaryMuscleId: 'rear_delt' },
      { id: 'bench_press', name: 'Bench Press', primaryMuscleId: 'mid_chest' },
      { id: 'row_erg', name: 'Row Erg', primaryMuscleId: 'cardiovascular' },
      // A row pointing at a muscle that was never seeded must not abort the whole
      // upgrade — that would leave the device unopenable.
      { id: 'orphan', name: 'Orphan', primaryMuscleId: 'does_not_exist' },
    ])
    old.close()

    const upgraded = new WorkoutDatabase(NAME)
    await upgraded.open()

    expect(upgraded.verno).toBe(9)
    const rows = await upgraded.exercises.toArray()
    const byId = new Map(rows.map((e) => [e.id, e]))
    expect(byId.get('reverse_fly')!.region).toBe('shoulders')
    expect(byId.get('bench_press')!.region).toBe('chest')
    expect(byId.get('row_erg')!.region).toBe('cardio')
    expect(byId.get('orphan')!.region).toBe('core')

    // The pointer is gone from every row, so nothing can still read through it.
    for (const row of rows) {
      expect(row).not.toHaveProperty('primaryMuscleId')
    }
    expect(upgraded.tables.map((t) => t.name)).not.toContain('muscles')

    upgraded.close()
  })

  it('opens a brand-new database straight at the current version', async () => {
    const fresh = new WorkoutDatabase(NAME)
    await fresh.open()
    expect(fresh.verno).toBe(9)
    expect(fresh.tables.map((t) => t.name)).not.toContain('muscles')
    fresh.close()
  })
})

describe('v9 — the outbox becomes one entry per dirty row', () => {
  it('collapses duplicate entries for a row and drops the frozen payload', async () => {
    const old = openAtV7()
    await old.open()
    // Two edits to the same row, plus one to another: the old shape appended.
    await old.table('outbox').bulkAdd([
      { table: 'sets', op: 'insert', rowId: 'set-1', payload: { reps: 5 }, clientRev: 1, queuedAt: 1, attempts: 0 },
      { table: 'sets', op: 'update', rowId: 'set-1', payload: { reps: 6 }, clientRev: 2, queuedAt: 2, attempts: 0 },
      { table: 'workouts', op: 'insert', rowId: 'w-1', payload: { title: 'A' }, clientRev: 1, queuedAt: 3, attempts: 0 },
    ])
    await old.table('deadLetter').add({
      table: 'sets', op: 'update', rowId: 'set-9', payload: { reps: 9 },
      clientRev: 3, queuedAt: 4, failedAt: 5, error: 'nope',
    })
    old.close()

    const upgraded = new WorkoutDatabase(NAME)
    await upgraded.open()

    const entries = await upgraded.outbox.orderBy('seq').toArray()
    expect(entries).toHaveLength(2)
    // The earliest entry per row survives, so push order still puts parents first.
    const set = entries.find((e) => e.rowId === 'set-1')!
    expect(set.queuedAt).toBe(1)
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('op')
      expect(entry).not.toHaveProperty('payload')
      expect(entry).not.toHaveProperty('clientRev')
    }

    // The dead letter keeps its snapshot, under the name the new shape uses.
    const dead = (await upgraded.deadLetter.toArray())[0]!
    expect(dead.row).toEqual({ reps: 9 })
    expect(dead).not.toHaveProperty('payload')

    upgraded.close()
  })
})
