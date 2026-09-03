import { describe, expect, it } from 'vitest'
import type { Exercise, WorkoutSet } from '@/domain/types'
import {
  bestEffectiveOneRepMaxKg,
  bestOneRepMaxKg,
  effectiveTopSetKg,
  effectiveWeightKg,
  estimatedOneRepMaxKg,
  isWorkingSet,
  needsBodyweight,
  topSetWeightKg,
  volumeLoadKg,
  weightForRepsKg,
} from '@/lib/metrics'

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
    expect(effectiveWeightKg(set(), exercise(), 80, null)).toBe(100)
  })

  it('is a fraction of bodyweight for a bodyweight-mode movement', () => {
    const pushup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 0.64 })
    expect(effectiveWeightKg(set({ weightKg: null }), pushup, 80, 'bodyweight')).toBeCloseTo(
      51.2,
    )
  })

  it('adds the belt weight in weighted mode', () => {
    const pullup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 1 })
    expect(effectiveWeightKg(set({ weightKg: 20 }), pullup, 80, 'weighted')).toBe(100)
  })

  it('subtracts machine assistance in assisted mode', () => {
    const dip = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 0.95 })
    expect(effectiveWeightKg(set({ weightKg: 30 }), dip, 80, 'assisted')).toBeCloseTo(46)
  })

  it('never goes negative when assistance exceeds bodyweight', () => {
    const dip = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 1 })
    expect(effectiveWeightKg(set({ weightKg: 200 }), dip, 80, 'assisted')).toBe(0)
  })

  it('is null for cardio and rep-only work', () => {
    expect(
      effectiveWeightKg(set(), exercise({ trackingType: 'distance_time' }), 80, null),
    ).toBeNull()
    expect(
      effectiveWeightKg(set(), exercise({ trackingType: 'reps_only' }), 80, null),
    ).toBeNull()
    expect(
      effectiveWeightKg(set(), exercise({ trackingType: 'time' }), 80, null),
    ).toBeNull()
  })

  it('is null when bodyweight is unknown for a bodyweight movement', () => {
    const pushup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 0.64 })
    expect(effectiveWeightKg(set({ weightKg: null }), pushup, null, 'bodyweight')).toBeNull()
  })

  it('is null for EVERY bodyweight mode when bodyweight is unknown', () => {
    // Including `weighted`: its load is bodyweight + plates, so the plates alone
    // are not a usable number. The UI asks for a bodyweight instead (needsBodyweight).
    const pullup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 1 })
    expect(effectiveWeightKg(set({ weightKg: 20 }), pullup, null, 'weighted')).toBeNull()
    expect(effectiveWeightKg(set({ weightKg: 20 }), pullup, null, 'assisted')).toBeNull()
  })

  it('takes the entered weight at face value for a dumbbell lift — no doubling (§6)', () => {
    // Equipment no longer affects the effective weight: the user logs the weight
    // they intend, so a 40 kg dumbbell entry is 40 kg of effective load, not 80.
    expect(effectiveWeightKg(set({ weightKg: 40 }), exercise(), 80, null)).toBe(40)
  })
})

describe('needsBodyweight', () => {
  it('flags a bodyweight movement with no session bodyweight, whatever the mode', () => {
    const pullup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 1 })
    expect(needsBodyweight(pullup, null)).toBe(true)
    expect(needsBodyweight(pullup, 80)).toBe(false)
  })

  it('never flags an externally-loaded lift', () => {
    expect(needsBodyweight(exercise(), null)).toBe(false)
  })
})

describe('volumeLoadKg', () => {
  it('sums weight times reps', () => {
    expect(volumeLoadKg([set(), set()], exercise(), 80, null)).toBe(1000)
  })

  it('scores zero for bodyweight work with no bodyweight — the case needsBodyweight guards', () => {
    const pullup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 1 })
    expect(volumeLoadKg([set({ weightKg: null, reps: 10 })], pullup, null, 'bodyweight')).toBe(0)
    // With a bodyweight it counts the full effective load (80 kg × 10).
    expect(volumeLoadKg([set({ weightKg: null, reps: 10 })], pullup, 80, 'bodyweight')).toBe(800)
    // Weighted adds the plates on top: (80 + 20) × 5.
    expect(volumeLoadKg([set({ weightKg: 20, reps: 5 })], pullup, 80, 'weighted')).toBe(500)
  })

  it('leaves planned-but-unperformed sets out of the total', () => {
    const sets = [set({ isCompleted: false, weightKg: 60, reps: 10 }), set()]
    expect(volumeLoadKg(sets, exercise(), 80, null)).toBe(500)
  })

  it('counts effective bodyweight load, so assisted work is not zero volume', () => {
    const dip = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 0.95 })
    // (80×0.95 − 20) × 5 = 280
    const sets = [set({ weightKg: 20, reps: 5 })]
    expect(volumeLoadKg(sets, dip, 80, 'assisted')).toBeCloseTo(280)
  })

  it('contributes nothing for cardio, so a run never inflates lifting volume', () => {
    const treadmill = exercise({ trackingType: 'distance_time' })
    const sets = [
      set({ weightKg: null, reps: null, durationSeconds: 1800, distanceM: 5000 }),
    ]
    expect(volumeLoadKg(sets, treadmill, 80, null)).toBe(0)
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

describe('effective-load e1RM / top-set (the canonical read-path helpers)', () => {
  const pullup = exercise({ trackingType: 'bodyweight_reps', bodyweightFactor: 1 })

  it('pure bodyweight uses bodyweight×factor, not the (null/0) entered weight', () => {
    const sets = [set({ weightKg: null, reps: 10 })]
    // topSetWeightKg on raw weight would be null; effective is bodyweight.
    expect(topSetWeightKg(sets)).toBeNull()
    expect(effectiveTopSetKg(sets, pullup, 80, 'bodyweight')).toBe(80)
    // e1RM on raw weight is null; effective ≈ 80 × (1 + 10/30).
    expect(bestOneRepMaxKg(sets)).toBeNull()
    expect(bestEffectiveOneRepMaxKg(sets, pullup, 80, 'bodyweight')).toBeCloseTo(
      80 * (1 + 10 / 30),
      5,
    )
  })

  it('weighted mode adds the entered weight to bodyweight', () => {
    const sets = [set({ weightKg: 20, reps: 5 })]
    expect(effectiveTopSetKg(sets, pullup, 80, 'weighted')).toBe(100)
    expect(bestEffectiveOneRepMaxKg(sets, pullup, 80, 'weighted')).toBeCloseTo(
      100 * (1 + 5 / 30),
      5,
    )
  })

  it('a plain weighted lift matches the raw helpers (no bodyweight added)', () => {
    const sets = [set({ weightKg: 140, reps: 3 })]
    const barbell = exercise({ trackingType: 'weight_reps' })
    expect(effectiveTopSetKg(sets, barbell, 80, null)).toBe(topSetWeightKg(sets))
    expect(bestEffectiveOneRepMaxKg(sets, barbell, 80, null)).toBe(bestOneRepMaxKg(sets))
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
