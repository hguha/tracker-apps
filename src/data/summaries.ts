// Read-only rollups over finished sessions: the History list summaries, the
// workout/template previews, Home's badge stats, and the de-identified coach
// summary. Everything here derives, nothing mutates.

import { db } from '@/db/database'
import { isCardioPattern } from '@/domain/movement'
import {
  type DistanceUnit,
  type Exercise,
  type Region,
  type WeightUnit,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/domain/types'
import {
  type CoachSummary,
  SUMMARY_WEEKS,
  type SummarySession,
  buildCoachSummary,
} from '@/features/coach/summary'
import { weekStart } from '@/lib/dates'
import { composeExerciseName } from '@/lib/labels'
import { isWorkingSet, volumeLoadKg } from '@/lib/metrics'
import { type SetSignal, sessionTitle } from '@/lib/sessionTitle'
import { formatDistance, formatWeight } from '@/lib/units'
import { getProfile } from './profile'
import { listSets } from './sets'
import { getWorkout, listWorkoutExercises, listWorkouts } from './workouts'

export async function listFinishedWorkoutSummaries(
  limit = 100,
): Promise<WorkoutSummary[]> {
  return (await listWorkoutSummaries(limit)).filter((s) => s.workout.endedAt !== null)
}

export interface WorkoutSummary {
  workout: Workout
  title: string
  exerciseNames: string[]
  exerciseIds: string[]
  regions: Region[]
  setCount: number
  volumeKg: number
  durationSeconds: number | null
  cardioSeconds: number
  workingSetsByRegion: Partial<Record<Region, number>>
}

function buildWorkoutSummary(
  workout: Workout,
  workoutExercises: WorkoutExercise[],
  exercisesById: Map<string, Exercise>,
  setsByWe: Map<string, WorkoutSet[]>,
): WorkoutSummary {
  const exerciseNames: string[] = []
  const exerciseIds: string[] = []
  const regionSet = new Set<Region>()
  const workingSetsByRegion: Partial<Record<Region, number>> = {}
  let setCount = 0
  let volumeKg = 0
  let cardioSeconds = 0
  const signals: SetSignal[] = []

  for (const we of workoutExercises) {
    const exercise = exercisesById.get(we.exerciseId)
    if (!exercise) continue
    exerciseNames.push(composeExerciseName(exercise.name, we.equipment))
    exerciseIds.push(exercise.id)

    const region = exercise.region
    regionSet.add(region)

    const logged = (setsByWe.get(we.id) ?? []).filter((s) => s.isCompleted)
    setCount += logged.length
    volumeKg += volumeLoadKg(logged, exercise, workout.bodyweightKg)

    if (isCardioPattern(exercise.movementPattern)) {
      cardioSeconds += logged.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
    }

    if (region) {
      const workingSets = logged.filter((s) => isWorkingSet(s)).length
      if (workingSets > 0) {
        workingSetsByRegion[region] = (workingSetsByRegion[region] ?? 0) + workingSets
      }
      for (let i = 0; i < logged.length; i += 1) {
        signals.push({ region, pattern: exercise.movementPattern })
      }
    }
  }

  return {
    workout,
    title: sessionTitle(
      workout.title,
      workout.startedAt,
      signals.filter((s) => s.region !== undefined),
    ),
    exerciseNames,
    exerciseIds,
    regions: [...regionSet],
    setCount,
    volumeKg,
    durationSeconds:
      workout.endedAt !== null ? (workout.endedAt - workout.startedAt) / 1000 : null,
    cardioSeconds,
    workingSetsByRegion,
  }
}

export async function listWorkoutSummaries(limit = 100): Promise<WorkoutSummary[]> {
  const workouts = await listWorkouts(limit)
  if (workouts.length === 0) return []

  const workoutIds = workouts.map((w) => w.id)
  const allWe = (
    await db.workoutExercises.where('workoutId').anyOf(workoutIds).toArray()
  ).filter((r) => r.deletedAt === null)

  const weIds = allWe.map((we) => we.id)
  const allSets = (
    await db.sets.where('workoutExerciseId').anyOf(weIds).toArray()
  ).filter((s) => s.deletedAt === null)

  const exercises = await db.exercises.bulkGet([
    ...new Set(allWe.map((we) => we.exerciseId)),
  ])
  const exercisesById = new Map<string, Exercise>()
  exercises.forEach((ex) => ex && exercisesById.set(ex.id, ex))

  const weByWorkout = new Map<string, WorkoutExercise[]>()
  for (const we of allWe) {
    const list = weByWorkout.get(we.workoutId)
    if (list) list.push(we)
    else weByWorkout.set(we.workoutId, [we])
  }
  for (const list of weByWorkout.values()) list.sort((a, b) => a.position - b.position)

  const setsByWe = new Map<string, WorkoutSet[]>()
  for (const set of allSets) {
    const list = setsByWe.get(set.workoutExerciseId)
    if (list) list.push(set)
    else setsByWe.set(set.workoutExerciseId, [set])
  }
  for (const list of setsByWe.values()) list.sort((a, b) => a.position - b.position)

  return workouts.map((w) =>
    buildWorkoutSummary(w, weByWorkout.get(w.id) ?? [], exercisesById, setsByWe),
  )
}

// Base exercise ids (§4.3): equipment is a dimension of the workout now, so the
// squat/bench badges credit any equipment of the movement.

export const BIG_THREE = {
  squat: 'back_squat',
  bench: 'bench_press',
  deadlift: 'deadlift',
} as const

export interface BadgeStats {
  bestSquatE1rmKg: number
  bestBenchE1rmKg: number
  bestDeadliftE1rmKg: number
  bestAnyE1rmKg: number
  totalCardioMeters: number
  totalCardioSeconds: number
  distinctExercises: number
}

export async function getBadgeStats(): Promise<BadgeStats> {
  const e1rmPrs = (await db.personalRecords.toArray()).filter(
    (pr) => pr.recordType === 'max_est_1rm' && pr.deletedAt === null,
  )
  const bestE1rmByExercise = new Map<string, number>()
  let bestAnyE1rmKg = 0
  for (const pr of e1rmPrs) {
    if (pr.value > (bestE1rmByExercise.get(pr.exerciseId) ?? 0)) {
      bestE1rmByExercise.set(pr.exerciseId, pr.value)
    }
    if (pr.value > bestAnyE1rmKg) bestAnyE1rmKg = pr.value
  }

  const workouts = await listWorkouts(1000)
  const workoutIds = workouts.map((w) => w.id)
  const allWe = (
    await db.workoutExercises.where('workoutId').anyOf(workoutIds).toArray()
  ).filter((r) => r.deletedAt === null)
  const exercises = await db.exercises.bulkGet([
    ...new Set(allWe.map((we) => we.exerciseId)),
  ])
  const patternByExercise = new Map<string, string>()
  exercises.forEach((ex) => ex && patternByExercise.set(ex.id, ex.movementPattern))
  const weToExercise = new Map(allWe.map((we) => [we.id, we.exerciseId]))

  const allSets = (
    await db.sets
      .where('workoutExerciseId')
      .anyOf(allWe.map((we) => we.id))
      .toArray()
  ).filter((s) => s.deletedAt === null && s.isCompleted)

  let totalCardioMeters = 0
  let totalCardioSeconds = 0
  const distinctExercises = new Set<string>()
  for (const set of allSets) {
    const exerciseId = weToExercise.get(set.workoutExerciseId)
    if (!exerciseId) continue
    distinctExercises.add(exerciseId)
    if (patternByExercise.get(exerciseId) === 'cardio') {
      totalCardioMeters += set.distanceM ?? 0
      totalCardioSeconds += set.durationSeconds ?? 0
    }
  }

  return {
    bestSquatE1rmKg: bestE1rmByExercise.get(BIG_THREE.squat) ?? 0,
    bestBenchE1rmKg: bestE1rmByExercise.get(BIG_THREE.bench) ?? 0,
    bestDeadliftE1rmKg: bestE1rmByExercise.get(BIG_THREE.deadlift) ?? 0,
    bestAnyE1rmKg,
    totalCardioMeters,
    totalCardioSeconds,
    distinctExercises: distinctExercises.size,
  }
}

// Feeds the AI coach (§13); the privacy contract lives in buildCoachSummary, which
// never sees a name, note, or absolute date.

export async function getCoachSummary(): Promise<CoachSummary> {
  const profile = await getProfile()

  const cutoff = Date.now() - SUMMARY_WEEKS * 7 * 24 * 3600 * 1000
  const thisWeekStart = weekStart(Date.now(), profile.weekStartsOn)
  const workouts = (await listWorkouts(1000)).filter(
    (w) => w.endedAt !== null && w.startedAt >= cutoff,
  )

  if (workouts.length === 0) {
    return buildCoachSummary({
      unitWeight: profile.unitWeight,
      unitLength: profile.unitLength,
      weeklyWorkoutGoal: profile.weeklyWorkoutGoal || 4,
      bodyweightKg: profile.bodyweightCacheKg,
      heightCm: profile.heightCm ?? null,
      trainingGoal: profile.trainingGoal ?? '',
      sessions: [],
    })
  }

  const allWe = (
    await db.workoutExercises
      .where('workoutId')
      .anyOf(workouts.map((w) => w.id))
      .toArray()
  ).filter((r) => r.deletedAt === null)
  const exercises = await db.exercises.bulkGet([
    ...new Set(allWe.map((we) => we.exerciseId)),
  ])
  const exercisesById = new Map<string, Exercise>()
  exercises.forEach((ex) => ex && exercisesById.set(ex.id, ex))
  const allSets = (
    await db.sets
      .where('workoutExerciseId')
      .anyOf(allWe.map((we) => we.id))
      .toArray()
  ).filter((s) => s.deletedAt === null && s.isCompleted)

  const setsByWe = new Map<string, WorkoutSet[]>()
  for (const s of allSets) {
    const list = setsByWe.get(s.workoutExerciseId)
    if (list) list.push(s)
    else setsByWe.set(s.workoutExerciseId, [s])
  }
  const weByWorkout = new Map<string, WorkoutExercise[]>()
  for (const we of allWe) {
    const list = weByWorkout.get(we.workoutId)
    if (list) list.push(we)
    else weByWorkout.set(we.workoutId, [we])
  }

  const WEEK_MS = 7 * 24 * 3600 * 1000
  const sessions: SummarySession[] = workouts.map((w) => {
    const weekOffset = Math.round(
      (weekStart(w.startedAt, profile.weekStartsOn) - thisWeekStart) / WEEK_MS,
    )
    const exerciseInstances = (weByWorkout.get(w.id) ?? [])
      .map((we) => {
        const exercise = exercisesById.get(we.exerciseId)
        if (!exercise) return null
        return {
          exerciseId: exercise.id,
          name: exercise.name,
          region: exercise.region,
          pattern: exercise.movementPattern,
          equipment: we.equipment,
          isCardio: isCardioPattern(exercise.movementPattern),
          sets: (setsByWe.get(we.id) ?? []).map((s) => ({
            weightKg: s.weightKg,
            reps: s.reps,
            rpe: s.rpe,
            durationSeconds: s.durationSeconds,
            distanceM: s.distanceM,
          })),
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
    return { weekOffset, exercises: exerciseInstances }
  })

  return buildCoachSummary({
    unitWeight: profile.unitWeight,
    unitLength: profile.unitLength,
    weeklyWorkoutGoal: profile.weeklyWorkoutGoal || 4,
    bodyweightKg: profile.bodyweightCacheKg,
    heightCm: profile.heightCm ?? null,
    trainingGoal: profile.trainingGoal ?? '',
    sessions,
  })
}

export interface WorkoutPreview {
  title: string
  performedAt: number | null
  exercises: {
    name: string
    region: Region | undefined
    detail: string
    setCount: number
  }[]
  totalSets: number
}

export async function getWorkoutPreview(
  workoutId: string,
): Promise<WorkoutPreview | null> {
  const workout = await getWorkout(workoutId)
  if (!workout) return null
  const profile = await getProfile()
  const workoutExercises = await listWorkoutExercises(workoutId)
  const signals: SetSignal[] = []

  const exercises: WorkoutPreview['exercises'] = []
  let totalSets = 0

  for (const we of workoutExercises) {
    const exercise = await db.exercises.get(we.exerciseId)
    if (!exercise) continue
    const region = exercise.region
    const logged = (await listSets(we.id)).filter((s) => s.isCompleted)
    totalSets += logged.length
    if (region) {
      for (let i = 0; i < logged.length; i += 1) {
        signals.push({ region, pattern: exercise.movementPattern })
      }
    }
    exercises.push({
      name: composeExerciseName(exercise.name, we.equipment),
      region,
      detail: summarizeSets(logged, profile.unitWeight, profile.unitDistance),
      setCount: logged.length,
    })
  }

  return {
    title: sessionTitle(workout.title, workout.startedAt, signals),
    performedAt: workout.startedAt,
    exercises,
    totalSets,
  }
}

function summarizeSets(
  sets: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>[],
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  const working = sets
  if (working.length === 0) return 'no sets'

  const first = working[0]!
  if (first.durationSeconds !== null) {
    const seconds = working.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
    const meters = working.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)
    const mins = Math.round(seconds / 60)
    return meters > 0
      ? `${mins} min · ${formatDistance(meters, distanceUnit)}`
      : `${mins} min`
  }

  const reps = working.map((s) => s.reps).filter((r): r is number => r !== null)
  const weights = working.map((s) => s.weightKg).filter((w): w is number => w !== null)
  const repPart =
    reps.length === 0
      ? ''
      : Math.min(...reps) === Math.max(...reps)
        ? ` × ${reps[0]}`
        : ` × ${Math.min(...reps)}-${Math.max(...reps)}`
  const weightPart =
    weights.length > 0 ? ` @ ${formatWeight(Math.max(...weights), weightUnit)}` : ''
  return `${working.length} sets${repPart}${weightPart}`
}
