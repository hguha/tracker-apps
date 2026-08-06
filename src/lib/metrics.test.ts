import { describe, expect, it } from 'vitest'
import type { Exercise, WorkoutSet } from '@/domain/types'
import {
  attributeVolumeToMuscles,
  bestOneRepMaxKg,
  countsTowardVolume,
  effectiveWeightKg,
  estimatedOneRepMaxKg,
  isWorkingSet,
  paceSecondsPerM,
  rollUpToRegions,
  tonnagePerMinute,
  topSetWeightKg,
  volumeLoadKg,
  weightForRepsKg,
} from './metrics'

type SetInput = Parameters<typeof volumeLoadKg>[0][number] & Pick<WorkoutSet, 'rpe'>

function set(partial: Partial<SetInput> = {}): SetInput {
  return {
    setType: 'normal',
    weightKg: 100,
    reps: 5,
    durationSeconds: null,
    distanceM: null,
    rpe: null,
    isCompleted: true,
    ...partial,
  }
}

function exercise(partial: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex1',
    userId: null,
    name: 'Test',
    primaryMuscleId: 'm1',
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
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    clientRev: 1,
    ...partial,
  }
}

describe('countsTowardVolume', () => {
  it('excludes warmups', () => {
    expect(countsTowardVolume(set({ setType: 'warmup' }))).toBe(false)
  })

  it('excludes planned-but-not-performed sets', () => {
    expect(countsTowardVolume(set({ isCompleted: false }))).toBe(false)
  })

  it('includes dropsets and AMRAPs — they are real work', () => {
    expect(countsTowardVolume(set({ setType: 'dropset' }))).toBe(true)
    expect(countsTowardVolume(set({ setType: 'amrap' }))).toBe(true)
  })
})

describe('effectiveWeightKg', () => {
  it('is the entered weight for a loaded barbell movement', () => {
    expect(effectiveWeightKg(set(), exercise(), 80)).toBe(100)
  })

  it('is a fraction of bodyweight for a push-up', () => {
    const pushup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 0.64 })
    expect(effectiveWeightKg(set({ weightKg: null }), pushup, 80)).toBeCloseTo(51.2)
  })

  it('adds the belt weight for a weighted pull-up', () => {
    const pullup = exercise({ trackingType: 'weighted_bodyweight', bodyweightFactor: 1 })
    expect(effectiveWeightKg(set({ weightKg: 20 }), pullup, 80)).toBe(100)
  })

  it('subtracts machine assistance', () => {
    const dip = exercise({ trackingType: 'assisted_bodyweight', bodyweightFactor: 0.95 })
    expect(effectiveWeightKg(set({ weightKg: 30 }), dip, 80)).toBeCloseTo(46)
  })

  it('never goes negative when assistance exceeds bodyweight', () => {
    const dip = exercise({ trackingType: 'assisted_bodyweight', bodyweightFactor: 1 })
    expect(effectiveWeightKg(set({ weightKg: 200 }), dip, 80)).toBe(0)
  })

  it('is null for cardio and rep-only work', () => {
    expect(effectiveWeightKg(set(), exercise({ trackingType: 'distance_time' }), 80)).toBeNull()
    expect(effectiveWeightKg(set(), exercise({ trackingType: 'reps_only' }), 80)).toBeNull()
    expect(effectiveWeightKg(set(), exercise({ trackingType: 'time' }), 80)).toBeNull()
  })

  it('is null when bodyweight is unknown for a bodyweight movement', () => {
    const pushup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 0.64 })
    expect(effectiveWeightKg(set({ weightKg: null }), pushup, null)).toBeNull()
  })

  it('doubles a two-arm dumbbell lift — a pair moves each rep (§6)', () => {
    const dbPress = exercise({ equipment: 'dumbbell', isUnilateral: false })
    // The user enters one 40 kg dumbbell; the load moved is 80 kg.
    expect(effectiveWeightKg(set({ weightKg: 40 }), dbPress, 80)).toBe(80)
  })

  it('does not double a one-arm dumbbell lift — only one is held', () => {
    const oneArmRow = exercise({ equipment: 'dumbbell', isUnilateral: true })
    expect(effectiveWeightKg(set({ weightKg: 40 }), oneArmRow, 80)).toBe(40)
  })
})

describe('volumeLoadKg', () => {
  it('sums weight times reps', () => {
    expect(volumeLoadKg([set(), set()], exercise(), 80)).toBe(1000)
  })

  it('leaves warmups out of the total', () => {
    const sets = [set({ setType: 'warmup', weightKg: 60, reps: 10 }), set()]
    expect(volumeLoadKg(sets, exercise(), 80)).toBe(500)
  })

  it('contributes nothing for cardio, so a run never inflates lifting volume', () => {
    const treadmill = exercise({ trackingType: 'distance_time' })
    const sets = [set({ weightKg: null, reps: null, durationSeconds: 1800, distanceM: 5000 })]
    expect(volumeLoadKg(sets, treadmill, 80)).toBe(0)
  })
})

describe('isWorkingSet', () => {
  it('counts a normal logged set', () => {
    expect(isWorkingSet(set({ reps: 8 }))).toBe(true)
  })

  it('counts a set of heavy singles — low reps is not "easy"', () => {
    expect(isWorkingSet(set({ reps: 1, weightKg: 180 }))).toBe(true)
  })

  it('counts a set regardless of RPE, which is optional', () => {
    expect(isWorkingSet(set({ reps: 10, rpe: 5 }))).toBe(true)
    expect(isWorkingSet(set({ reps: 10, rpe: null }))).toBe(true)
  })

  it('excludes warmups', () => {
    expect(isWorkingSet(set({ setType: 'warmup', reps: 12 }))).toBe(false)
  })

  it('excludes a planned set that was never performed', () => {
    expect(isWorkingSet(set({ isCompleted: false }))).toBe(false)
  })
})

describe('estimatedOneRepMaxKg', () => {
  it('matches Epley at 5 reps', () => {
    // 100 × (1 + 5/30) = 116.67
    expect(estimatedOneRepMaxKg(100, 5)).toBeCloseTo(116.667, 2)
  })

  it('returns the weight itself at 1 rep', () => {
    expect(estimatedOneRepMaxKg(100, 1)).toBeCloseTo(103.333, 2)
  })

  it('refuses to estimate past 12 reps rather than fabricate a number', () => {
    expect(estimatedOneRepMaxKg(100, 13)).toBeNull()
    expect(estimatedOneRepMaxKg(100, 20)).toBeNull()
  })

  it('handles missing inputs', () => {
    expect(estimatedOneRepMaxKg(null, 5)).toBeNull()
    expect(estimatedOneRepMaxKg(100, null)).toBeNull()
    expect(estimatedOneRepMaxKg(0, 5)).toBeNull()
  })
})

describe('bestOneRepMaxKg', () => {
  it('picks the best across a session', () => {
    const sets = [
      { setType: 'normal' as const, weightKg: 100, reps: 5 },
      { setType: 'normal' as const, weightKg: 110, reps: 3 },
    ]
    // 110 × (1 + 3/30) = 121 beats 116.67
    expect(bestOneRepMaxKg(sets)).toBeCloseTo(121, 2)
  })

  it('ignores warmups', () => {
    const sets = [
      { setType: 'warmup' as const, weightKg: 200, reps: 1 },
      { setType: 'normal' as const, weightKg: 100, reps: 5 },
    ]
    expect(bestOneRepMaxKg(sets)).toBeCloseTo(116.667, 2)
  })

  it('is null when every set is outside the rep window', () => {
    expect(bestOneRepMaxKg([{ setType: 'normal', weightKg: 50, reps: 20 }])).toBeNull()
  })
})

describe('topSetWeightKg', () => {
  it('finds the heaviest working set', () => {
    expect(topSetWeightKg([set({ weightKg: 100 }), set({ weightKg: 120 })])).toBe(120)
  })

  it('ignores a heavy warmup', () => {
    expect(
      topSetWeightKg([set({ setType: 'warmup', weightKg: 200 }), set({ weightKg: 100 })]),
    ).toBe(100)
  })
})

describe('attributeVolumeToMuscles', () => {
  it('gives the primary muscle full credit', () => {
    const result = attributeVolumeToMuscles(1000, exercise())
    expect(result.get('m1')).toBe(1000)
  })

  it('gives secondaries partial credit', () => {
    const bench = exercise({
      primaryMuscleId: 'mid_chest',
      secondaryMuscles: [
        { muscleId: 'front_delt', contribution: 0.5 },
        { muscleId: 'triceps', contribution: 0.5 },
      ],
    })
    const result = attributeVolumeToMuscles(1000, bench)
    expect(result.get('mid_chest')).toBe(1000)
    expect(result.get('front_delt')).toBe(500)
    expect(result.get('triceps')).toBe(500)
  })

  it('survives a row whose secondaryMuscles is missing (a synced exercise)', () => {
    // A pulled row can arrive without the field; it must not throw "not
    // iterable" and blank the screen — just credit the primary.
    const broken = { primaryMuscleId: 'm1' } as unknown as Parameters<
      typeof attributeVolumeToMuscles
    >[1]
    const result = attributeVolumeToMuscles(1000, broken)
    expect(result.get('m1')).toBe(1000)
  })
})

describe('rollUpToRegions', () => {
  it('sums muscles into their regions', () => {
    const byMuscle = new Map([
      ['mid_chest', 1000],
      ['upper_chest', 500],
      ['triceps', 250],
    ])
    const regions = rollUpToRegions(byMuscle, (id) =>
      id === 'triceps' ? 'arms' : 'chest',
    )
    expect(regions.get('chest')).toBe(1500)
    expect(regions.get('arms')).toBe(250)
  })

  it('drops muscles it cannot place rather than inventing a region', () => {
    const regions = rollUpToRegions(new Map([['unknown', 100]]), () => undefined)
    expect(regions.size).toBe(0)
  })
})

describe('cardio and density', () => {
  it('computes pace', () => {
    expect(paceSecondsPerM(1800, 5000)).toBeCloseTo(0.36)
  })

  it('returns null pace for a zero distance', () => {
    expect(paceSecondsPerM(1800, 0)).toBeNull()
  })

  it('computes tonnage per minute', () => {
    expect(tonnagePerMinute(6000, 3600)).toBe(100)
  })

  it('returns null density for a zero-length session', () => {
    expect(tonnagePerMinute(6000, 0)).toBeNull()
  })
})

describe('weightForRepsKg (PR estimator projection)', () => {
  it('inverts Epley: projecting from a 1RM back to reps', () => {
    // 100 kg × 5 → e1RM; projecting that e1RM back to 5 reps returns ~100.
    const e1rm = estimatedOneRepMaxKg(100, 5)!
    expect(weightForRepsKg(e1rm, 5)).toBeCloseTo(100, 5)
  })

  it('a 1-rep projection scales the 1RM by the Epley factor', () => {
    expect(weightForRepsKg(150, 1)).toBeCloseTo(150 / (1 + 1 / 30), 5)
  })

  it('returns null past the 12-rep cap or for a non-positive max', () => {
    expect(weightForRepsKg(150, 15)).toBeNull()
    expect(weightForRepsKg(0, 5)).toBeNull()
  })
})
