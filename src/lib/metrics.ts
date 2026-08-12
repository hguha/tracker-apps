/**
 * Derived training metrics (§8.1). Pure functions — no I/O, no dates beyond
 * what's passed in — because these numbers appear both on the active workout
 * screen and in every chart, and the two must never disagree.
 *
 * When the Postgres side lands, each function here gets a SQL twin that must
 * agree with it on a shared fixture (§8.3).
 */

import type { Exercise, PerformedSet, Region, WorkoutSet } from '@/domain/types'

type VolumeInput = Pick<
  WorkoutSet,
  'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'
> & { isCompleted?: boolean }

/**
 * A set of real work — any logged set. Both the number shown to the user and the
 * predicate volume load uses; the warmup/dropset types that once excluded some
 * sets were removed.
 */
export function isWorkingSet(set: VolumeInput): boolean {
  return set.isCompleted !== false
}

/**
 * How many implements are moved per rep, so entered weight becomes total load.
 *
 * A two-arm dumbbell lift moves a dumbbell in each hand every rep, so the total
 * lifted is twice the weight the user enters (they enter one dumbbell — §6). A
 * one-arm (unilateral) dumbbell lift moves a single dumbbell. Everything else —
 * barbells, machines, cables — is entered as its true total, so the factor is 1.
 */
export function loadUnitsMoved(
  exercise: Pick<Exercise, 'equipment' | 'isUnilateral'>,
): number {
  return exercise.equipment === 'dumbbell' && !exercise.isUnilateral ? 2 : 1
}

/**
 * The weight actually moved, which is not the number the user typed:
 *   - Two-arm dumbbell lifts move a pair, so double the entered weight (§6).
 *   - Bodyweight movements move a fraction of the lifter's mass — a weighted
 *     pull-up at +20 kg for an 80 kg lifter is 100 kg per rep, not 20.
 *
 * This drives volume load only. Max-weight and e1RM PRs deliberately use the raw
 * entered weight, because "the 100s" is the strength number a lifter thinks in,
 * not the 200 kg of total tonnage.
 */
export function effectiveWeightKg(
  set: Pick<VolumeInput, 'weightKg'>,
  exercise: Pick<
    Exercise,
    'trackingType' | 'bodyweightFactor' | 'equipment' | 'isUnilateral'
  >,
  bodyweightKg: number | null,
): number | null {
  const entered = set.weightKg ?? 0
  const factor = exercise.bodyweightFactor ?? 1
  const bw = bodyweightKg

  switch (exercise.trackingType) {
    case 'weight_reps':
    case 'weight_time':
      return set.weightKg === null ? null : set.weightKg * loadUnitsMoved(exercise)
    case 'bodyweight_reps':
      return bw === null ? null : bw * factor
    case 'weighted_bodyweight':
      return bw === null ? null : bw * factor + entered
    case 'assisted_bodyweight':
      // The machine takes weight off, so assistance subtracts.
      return bw === null ? null : Math.max(0, bw * factor - entered)
    case 'reps_only':
    case 'time':
    case 'distance_time':
      return null
  }
}

/** Σ (effective weight × reps) over completed sets. */
export function volumeLoadKg(
  sets: VolumeInput[],
  exercise: Pick<
    Exercise,
    'trackingType' | 'bodyweightFactor' | 'equipment' | 'isUnilateral'
  >,
  bodyweightKg: number | null,
): number {
  let total = 0
  for (const set of sets) {
    if (!isWorkingSet(set)) continue
    const weight = effectiveWeightKg(set, exercise, bodyweightKg)
    if (weight === null || set.reps === null) continue
    total += weight * set.reps
  }
  return total
}

/**
 * Epley estimated one-rep max, deliberately capped at 12 reps.
 *
 * Above 12 the formula's error exceeds what it's measuring — a 20-rep set
 * would project an e1RM the lifter cannot come close to. Returning null is
 * more useful than a confident wrong number.
 */
export function estimatedOneRepMaxKg(
  weightKg: number | null,
  reps: number | null,
): number | null {
  if (weightKg === null || reps === null) return null
  if (reps < 1 || reps > 12) return null
  if (weightKg <= 0) return null
  // A single rep IS a one-rep max — there is nothing to estimate. Plain Epley
  // multiplies by (1 + 1/30) here, so a genuine 365×1 came back as 377: the app
  // claiming a max the lifter has never touched, and contradicting the 365 in
  // the field right above it.
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

/**
 * The weight you could expect to lift for a given rep count, from a known 1RM.
 *
 * The inverse of Epley: if `w × (1 + r/30)` estimates the 1RM, then a target
 * rep count `r` projects back to `oneRepMaxKg / (1 + r/30)`. Used by the PR
 * estimator to answer "what's my likely 5RM / 3RM?" from any logged set.
 */
export function weightForRepsKg(oneRepMaxKg: number, reps: number): number | null {
  if (oneRepMaxKg <= 0 || reps < 1 || reps > 12) return null
  return oneRepMaxKg / (1 + reps / 30)
}

export const PROJECTION_REPS = [1, 2, 3, 5, 8, 10, 12] as const

/** Best e1RM across a group of sets, ignoring sets outside the valid window. */
export function bestOneRepMaxKg(
  sets: Pick<PerformedSet, 'weightKg' | 'reps'>[],
): number | null {
  let best: number | null = null
  for (const set of sets) {
    const e1rm = estimatedOneRepMaxKg(set.weightKg, set.reps)
    if (e1rm !== null && (best === null || e1rm > best)) best = e1rm
  }
  return best
}

/** The heaviest completed working set, for the top-set line chart (B-9). */
export function topSetWeightKg(sets: VolumeInput[]): number | null {
  let best: number | null = null
  for (const set of sets) {
    if (!isWorkingSet(set) || set.weightKg === null) continue
    if (best === null || set.weightKg > best) best = set.weightKg
  }
  return best
}

/**
 * Spread one exercise's volume across the muscles that did the work.
 *
 * Primary muscle takes full credit; each secondary takes its contribution
 * weight. This is what stops a reverse dumbbell fly from being counted as
 * chest work just because it looks like a chest movement.
 */
export function attributeVolumeToMuscles(
  volumeKg: number,
  exercise: Pick<Exercise, 'primaryMuscleId' | 'secondaryMuscles'>,
): Map<string, number> {
  const byMuscle = new Map<string, number>()
  byMuscle.set(exercise.primaryMuscleId, volumeKg)
  // Tolerate a row missing its secondaries (e.g. one that arrived from a sync
  // pull, where secondaries live in a separate table) — treat it as none rather
  // than crashing the whole render.
  for (const secondary of exercise.secondaryMuscles ?? []) {
    const existing = byMuscle.get(secondary.muscleId) ?? 0
    byMuscle.set(secondary.muscleId, existing + volumeKg * secondary.contribution)
  }
  return byMuscle
}

export function rollUpToRegions(
  byMuscle: Map<string, number>,
  regionOf: (muscleId: string) => Region | undefined,
): Map<Region, number> {
  const byRegion = new Map<Region, number>()
  for (const [muscleId, value] of byMuscle) {
    const region = regionOf(muscleId)
    if (!region) continue
    byRegion.set(region, (byRegion.get(region) ?? 0) + value)
  }
  return byRegion
}

/** Seconds per unit distance. Kept separate from volume load, always (§8.1). */
export function paceSecondsPerM(
  durationSeconds: number | null,
  distanceM: number | null,
): number | null {
  if (!durationSeconds || !distanceM || distanceM <= 0) return null
  return durationSeconds / distanceM
}

/** Crude density proxy. Label it as such wherever it's shown. */
export function tonnagePerMinute(
  volumeKg: number,
  durationSeconds: number | null,
): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null
  return volumeKg / (durationSeconds / 60)
}
