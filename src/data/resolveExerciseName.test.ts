/**
 * Name resolution for coach plans.
 *
 * The coach writes free text. Every wrong answer here is visible and silly —
 * "Barbell Face Pull" — and it also files the work under an implement the user
 * never touched, so its records and ghost values go missing.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'
import { buildExerciseResolver } from './resolveExerciseName'
import type { Equipment } from '@/domain/types'

let resolve: ReturnType<typeof buildExerciseResolver>

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
  resolve = buildExerciseResolver(await repo.listExercises())
})

describe('equipment', () => {
  // The reported bug plus the rest of its family: the seed knows how each of these
  // is loaded, and every one of them used to come out barbell.
  const cases: [string, string, Equipment][] = [
    ['Face Pull', 'face_pull', 'cable'],
    ['Lat Pulldown', 'lat_pulldown', 'cable'],
    ['Leg Press', 'leg_press', 'machine'],
    ['Leg Extension', 'leg_extension', 'machine'],
    ['Lying Leg Curl', 'lying_leg_curl', 'machine'],
    ['Romanian Deadlift', 'romanian_deadlift', 'barbell'],
    ['Back Squat', 'back_squat', 'barbell'],
  ]

  for (const [name, exerciseId, equipment] of cases) {
    it(`resolves "${name}" to ${equipment}`, () => {
      expect(resolve(name)).toMatchObject({ exerciseId, equipment })
    })
  }

  it('reads the equipment out of a name that states one', () => {
    expect(resolve('Dumbbell Bench Press')).toMatchObject({
      exerciseId: 'bench_press',
      equipment: 'dumbbell',
    })
    expect(resolve('Smith Machine Bench Press')).toMatchObject({
      exerciseId: 'bench_press',
      equipment: 'smith',
    })
  })

  it('never asks for equipment on a movement that has no choice', () => {
    // These skip the equipment step in the picker, so the coach must agree with it
    // exactly or one movement's records split across two implements.
    expect(resolve('Push-up')).toMatchObject({
      exerciseId: 'push_up',
      equipment: 'bodyweight',
      confidence: 'tracking',
    })
    expect(resolve('Assisted Pull-up')).toMatchObject({
      exerciseId: 'assisted_pull_up',
      equipment: 'machine',
      confidence: 'tracking',
    })
  })

  it('prefers an explicit hint over anything it could infer', () => {
    expect(resolve('Bench Press', 'dumbbell')).toMatchObject({
      exerciseId: 'bench_press',
      equipment: 'dumbbell',
      confidence: 'hint',
    })
  })

  it('prefers what the user actually used over a generic default', async () => {
    const withHistory = buildExerciseResolver(
      await repo.listExercises(),
      new Map([['bench_press', 'dumbbell' as Equipment]]),
    )
    expect(withHistory('Bench Press')).toMatchObject({
      equipment: 'dumbbell',
      confidence: 'last-used',
    })
  })
})

describe('movement', () => {
  it('follows a name whose base was renamed for clarity', () => {
    // 'Curl' became 'Biceps Curl' and 'Fly' became 'Chest Fly'; a coach trained on
    // the old wording still says the old thing.
    expect(resolve('Cable Fly')).toMatchObject({
      exerciseId: 'chest_fly',
      equipment: 'cable',
    })
    expect(resolve('Barbell Curl')).toMatchObject({
      exerciseId: 'biceps_curl',
      equipment: 'barbell',
    })
  })

  it('matches an alias', () => {
    expect(resolve('OHP')?.exerciseId).toBe('overhead_press')
  })

  it('returns null for something that is not an exercise', () => {
    expect(resolve('Interpretive Dance')).toBeNull()
    expect(resolve('   ')).toBeNull()
  })
})

describe('a plan saved as templates', () => {
  it('stamps each exercise with the equipment it is actually done with', async () => {
    const { templateIds, unmatched } = await repo.createTemplatesFromPlan({
      sessions: [
        {
          name: 'Pull',
          exercises: [
            { name: 'Face Pull', sets: 3, repLow: 12, repHigh: 15, weight: null },
            { name: 'Lat Pulldown', sets: 3, repLow: 8, repHigh: 12, weight: null },
            { name: 'Barbell Row', sets: 3, repLow: 8, repHigh: 12, weight: null },
          ],
        },
      ],
      unitWeight: 'lb',
    })

    expect(unmatched).toEqual([])
    const rows = await repo.listTemplateExercises(templateIds[0]!)
    expect(rows.map((r) => [r.exerciseId, r.equipment])).toEqual([
      ['face_pull', 'cable'],
      ['lat_pulldown', 'cable'],
      ['row', 'barbell'],
    ])
  })
})
