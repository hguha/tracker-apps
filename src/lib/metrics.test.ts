import { describe, expect, it } from 'vitest'
import type { Exercise, WorkoutSet } from '@/domain/types'
import {
  bestOneRepMaxKg,
  effectiveWeightKg,
  estimatedOneRepMaxKg,
  isWorkingSet,
  topSetWeightKg,
  volumeLoadKg,
  weightForRepsKg,
} from './metrics'

type SetInput = Parameters<typeof volumeLoadKg>[0][number] & Pick<WorkoutSet, 'rpe'>

function set(partial: Partial<SetInput> = {}): SetInput {
  return {
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
    region: 'chest',
    aliases: [],
    movementPattern: 'push',
    trackingType: 'weight_reps',
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

describe('isWorkingSet', () => {
  it('counts a completed set', () => {
    expect(isWorkingSet(set())).toBe(true)
  })

  it('excludes planned-but-not-performed sets', () => {
    expect(isWorkingSet(set({ isCompleted: false }))).toBe(false)
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
    expect(
      effectiveWeightKg(set(), exercise({ trackingType: 'distance_time' }), 80),
    ).toBeNull()
    expect(
      effectiveWeightKg(set(), exercise({ trackingType: 'reps_only' }), 80),
    ).toBeNull()
    expect(effectiveWeightKg(set(), exercise({ trackingType: 'time' }), 80)).toBeNull()
  })

  it('is null when bodyweight is unknown for a bodyweight movement', () => {
    const pushup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 0.64 })
    expect(effectiveWeightKg(set({ weightKg: null }), pushup, null)).toBeNull()
  })

  it('takes the entered weight at face value for a dumbbell lift — no doubling (§6)', () => {
    // Equipment no longer affects the effective weight: the user logs the weight
    // they intend, so a 40 kg dumbbell entry is 40 kg of effective load, not 80.
    expect(effectiveWeightKg(set({ weightKg: 40 }), exercise(), 80)).toBe(40)
  })
})

describe('volumeLoadKg', () => {
  it('sums weight times reps', () => {
    expect(volumeLoadKg([set(), set()], exercise(), 80)).toBe(1000)
  })

  it('leaves planned-but-unperformed sets out of the total', () => {
    const sets = [set({ isCompleted: false, weightKg: 60, reps: 10 }), set()]
    expect(volumeLoadKg(sets, exercise(), 80)).toBe(500)
  })

  it('contributes nothing for cardio, so a run never inflates lifting volume', () => {
    const treadmill = exercise({ trackingType: 'distance_time' })
    const sets = [
      set({ weightKg: null, reps: null, durationSeconds: 1800, distanceM: 5000 }),
    ]
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
    // A single rep is already a 1RM, so there is nothing to estimate. Plain
    // Epley scales by (1 + 1/30) even at one rep, which reported a real 365×1
    // deadlift as a 377 max — a number the lifter has never touched, shown
    // directly above the 365 they typed.
    expect(estimatedOneRepMaxKg(100, 1)).toBe(100)
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
      { weightKg: 100, reps: 5 },
      { weightKg: 110, reps: 3 },
    ]
    // 110 × (1 + 3/30) = 121 beats 116.67
    expect(bestOneRepMaxKg(sets)).toBeCloseTo(121, 2)
  })

  it('is null when every set is outside the rep window', () => {
    expect(bestOneRepMaxKg([{ weightKg: 50, reps: 20 }])).toBeNull()
  })
})

describe('topSetWeightKg', () => {
  it('finds the heaviest working set', () => {
    expect(topSetWeightKg([set({ weightKg: 100 }), set({ weightKg: 120 })])).toBe(120)
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
