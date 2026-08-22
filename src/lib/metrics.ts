// Derived training metrics (§8.1). Pure functions; each gets a SQL twin that must
// agree with it on a shared fixture when the Postgres side lands (§8.3).

import type { Exercise, LoadMode, PerformedSet, WorkoutSet } from '@/domain/types'

type VolumeInput = Pick<
  WorkoutSet,
  'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'
> & { isCompleted?: boolean }

// The tracking facts volume math needs from the exercise.
type VolumeExercise = Pick<Exercise, 'trackingType' | 'bodyweightFactor'>

// A set counts as work unless explicitly marked incomplete.
export function isWorkingSet(set: VolumeInput): boolean {
  return set.isCompleted !== false
}

// Weight actually moved. The entered weight is taken at face value — for two-hand
// implements (a pair of dumbbells) the user logs the combined weight, so there's
// no equipment-specific doubling. Bodyweight movements add a fraction of
// bodyweight, and the load mode decides whether the entered weight adds to that
// (weighted), subtracts from it (assisted), or is absent (bodyweight). Used for
// volume and — for bodyweight movements — the weight/e1RM records too, so all
// three modes compare on one effective-load scale.
export function effectiveWeightKg(
  set: Pick<VolumeInput, 'weightKg'>,
  exercise: VolumeExercise,
  bodyweightKg: number | null,
  loadMode: LoadMode | null,
): number | null {
  const entered = set.weightKg ?? 0
  const factor = exercise.bodyweightFactor ?? 1
  const bw = bodyweightKg

  switch (exercise.trackingType) {
    case 'weight_reps':
    case 'weight_time':
      return set.weightKg
    case 'bodyweight_reps': {
      if (bw === null) return null
      const base = bw * factor
      if (loadMode === 'weighted') return base + entered
      // The machine takes weight off, so assistance subtracts.
      if (loadMode === 'assisted') return Math.max(0, base - entered)
      return base
    }
    case 'reps_only':
    case 'time':
    case 'distance_time':
      return null
  }
}

export function volumeLoadKg(
  sets: VolumeInput[],
  exercise: VolumeExercise,
  bodyweightKg: number | null,
  loadMode: LoadMode | null,
): number {
  let total = 0
  for (const set of sets) {
    if (!isWorkingSet(set)) continue
    const weight = effectiveWeightKg(set, exercise, bodyweightKg, loadMode)
    if (weight === null || set.reps === null) continue
    total += weight * set.reps
  }
  return total
}

// Epley e1RM, capped at 12 reps — above that the formula's error exceeds what it
// measures, so null beats a confident wrong number (§8.1).
export function estimatedOneRepMaxKg(
  weightKg: number | null,
  reps: number | null,
): number | null {
  if (weightKg === null || reps === null) return null
  if (reps < 1 || reps > 12) return null
  if (weightKg <= 0) return null
  // A single rep is already a 1RM; plain Epley would inflate it (365×1 → 377).
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

// Inverse Epley: the weight for a target rep count from a known 1RM.
export function weightForRepsKg(oneRepMaxKg: number, reps: number): number | null {
  if (oneRepMaxKg <= 0 || reps < 1 || reps > 12) return null
  return oneRepMaxKg / (1 + reps / 30)
}

export const PROJECTION_REPS = [1, 2, 3, 5, 8, 10, 12] as const

// Returns the set the best estimate came from, not just the number, so an
// estimate can always be shown next to the real lift behind it.
export function bestOneRepMaxSet(
  sets: Pick<PerformedSet, 'weightKg' | 'reps'>[],
): { weightKg: number; reps: number; e1rmKg: number } | null {
  let best: { weightKg: number; reps: number; e1rmKg: number } | null = null
  for (const set of sets) {
    const e1rmKg = estimatedOneRepMaxKg(set.weightKg, set.reps)
    if (e1rmKg === null || set.weightKg === null || set.reps === null) continue
    if (best === null || e1rmKg > best.e1rmKg) {
      best = { weightKg: set.weightKg, reps: set.reps, e1rmKg }
    }
  }
  return best
}

export function bestOneRepMaxKg(
  sets: Pick<PerformedSet, 'weightKg' | 'reps'>[],
): number | null {
  return bestOneRepMaxSet(sets)?.e1rmKg ?? null
}

/** Heaviest completed working set by raw entered weight, for the top-set line chart (B-9). */
export function topSetWeightKg(sets: VolumeInput[]): number | null {
  let best: number | null = null
  for (const set of sets) {
    if (!isWorkingSet(set) || set.weightKg === null) continue
    if (best === null || set.weightKg > best) best = set.weightKg
  }
  return best
}

// e1RM/top-set on effective weight (bw×factor ± entered), so a bodyweight lift's
// numbers reflect what was moved. The canonical read-path helpers — records,
// insights, and the coach all use them so a lift reads the same everywhere.
export function bestEffectiveOneRepMaxKg(
  sets: VolumeInput[],
  exercise: VolumeExercise,
  bodyweightKg: number | null,
  loadMode: LoadMode | null,
): number | null {
  return bestOneRepMaxKg(
    sets.map((set) => ({
      weightKg: effectiveWeightKg(set, exercise, bodyweightKg, loadMode),
      reps: set.reps,
    })),
  )
}

export function effectiveTopSetKg(
  sets: VolumeInput[],
  exercise: VolumeExercise,
  bodyweightKg: number | null,
  loadMode: LoadMode | null,
): number | null {
  let best: number | null = null
  for (const set of sets) {
    if (!isWorkingSet(set)) continue
    const weight = effectiveWeightKg(set, exercise, bodyweightKg, loadMode)
    if (weight === null) continue
    if (best === null || weight > best) best = weight
  }
  return best
}
