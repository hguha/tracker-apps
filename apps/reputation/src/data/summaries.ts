// Read-only rollups over finished sessions: the History list summaries, the
// workout/template previews, Home's badge stats, and the de-identified coach
// summary. Everything here derives, nothing mutates.

import { plural } from '@tracker-engine/core'
import { db } from '@/db/database'
import { isCardioPattern } from '@/domain/movement'
import {
  type DistanceUnit,
  type Exercise,
  type RecordType,
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
} from './coachSummary'
import { groupBy } from '@tracker-engine/core'
import { WEEK_MS, dayKey, dayStreaks, weekOffset } from '@/lib/dates'
import { composeExerciseName } from '@/lib/labels'
import { effectiveWeightKg, isWorkingSet, volumeLoadKg } from '@/lib/metrics'
import {
  countRecordBreakingSessions,
  progressRecordValues,
  type SessionRecordValues,
} from './records'
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
    volumeKg += volumeLoadKg(logged, exercise, workout.bodyweightKg, we.loadMode)

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

// The live exercises and sets under a batch of workouts, in three queries.
async function loadWorkoutRows(workouts: Workout[]): Promise<{
  workoutExercises: WorkoutExercise[]
  sets: WorkoutSet[]
  exercisesById: Map<string, Exercise>
}> {
  const workoutExercises = (
    await db.workoutExercises
      .where('workoutId')
      .anyOf(workouts.map((w) => w.id))
      .toArray()
  ).filter((r) => r.deletedAt === null)
  const sets = (
    await db.sets
      .where('workoutExerciseId')
      .anyOf(workoutExercises.map((we) => we.id))
      .toArray()
  ).filter((s) => s.deletedAt === null)
  const exercises = await db.exercises.bulkGet([
    ...new Set(workoutExercises.map((we) => we.exerciseId)),
  ])
  const exercisesById = new Map<string, Exercise>()
  for (const exercise of exercises) if (exercise) exercisesById.set(exercise.id, exercise)
  return { workoutExercises, sets, exercisesById }
}

const byPosition = (a: { position: number }, b: { position: number }) =>
  a.position - b.position

export async function listWorkoutSummaries(limit = 100): Promise<WorkoutSummary[]> {
  const workouts = await listWorkouts(limit)
  if (workouts.length === 0) return []

  const { workoutExercises, sets, exercisesById } = await loadWorkoutRows(workouts)
  const weByWorkout = groupBy(workoutExercises.sort(byPosition), (we) => we.workoutId)
  const setsByWe = groupBy(sets.sort(byPosition), (s) => s.workoutExerciseId)

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

// The lifts beyond the big three that carry their own milestones.
export const BADGE_LIFTS = {
  overheadPress: 'overhead_press',
  row: 'barbell_row',
  pullUp: 'pull_up',
  dip: 'dip',
} as const

export interface BadgeStats {
  bestSquatE1rmKg: number
  bestBenchE1rmKg: number
  bestDeadliftE1rmKg: number
  bestAnyE1rmKg: number
  bestOverheadPressE1rmKg: number
  bestRowE1rmKg: number
  bestPullUpE1rmKg: number
  bestDipE1rmKg: number
  totalCardioMeters: number
  totalCardioSeconds: number
  distinctExercises: number
  /** Distinct body regions trained — the balance measure. */
  distinctRegions: number
  totalReps: number
  /** Reps on bodyweight movements (pull-ups, dips, push-ups). */
  totalBodyweightReps: number
  /** Most reps in a single set, for the high-rep grinder badges. */
  maxRepsInSet: number
  /** Heaviest single completed set, whatever the lift. */
  maxSetWeightKg: number
  /** Distinct calendar days with a logged workout. */
  totalDaysTrained: number
  /** Longest run of consecutive calendar days trained. */
  bestDayStreak: number
  /** Sessions started before 07:00 / at or after 21:00 — habit badges. */
  earlyWorkouts: number
  lateWorkouts: number
  weekendWorkouts: number
  recordSessions: number
  totalTrainingSeconds: number
  longestWorkoutSeconds: number
  /** Latest bodyweight, for relative-strength badges. 0 when unknown. */
  bodyweightKg: number
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
  const { workoutExercises, sets, exercisesById } = await loadWorkoutRows(workouts)
  const weToExercise = new Map(workoutExercises.map((we) => [we.id, we.exerciseId]))
  const allSets = sets.filter((s) => s.isCompleted)

  let totalCardioMeters = 0
  let totalCardioSeconds = 0
  let totalReps = 0
  let totalBodyweightReps = 0
  let maxRepsInSet = 0
  let maxSetWeightKg = 0
  const distinctExercises = new Set<string>()
  const distinctRegions = new Set<string>()
  for (const set of allSets) {
    const exerciseId = weToExercise.get(set.workoutExerciseId)
    if (!exerciseId) continue
    distinctExercises.add(exerciseId)
    const exercise = exercisesById.get(exerciseId)
    if (exercise) distinctRegions.add(exercise.region)

    const reps = set.reps ?? 0
    totalReps += reps
    if (reps > maxRepsInSet) maxRepsInSet = reps
    if ((set.weightKg ?? 0) > maxSetWeightKg) maxSetWeightKg = set.weightKg ?? 0
    if (exercise?.trackingType === 'bodyweight_reps') {
      totalBodyweightReps += reps
    }

    if (exercise?.movementPattern === 'cardio') {
      totalCardioMeters += set.distanceM ?? 0
      totalCardioSeconds += set.durationSeconds ?? 0
    }
  }

  // Session-shaped stats: when you train, and for how long.
  const finished = workouts.filter((w) => w.endedAt !== null)
  let earlyWorkouts = 0
  let lateWorkouts = 0
  let weekendWorkouts = 0
  let totalTrainingSeconds = 0
  let longestWorkoutSeconds = 0
  const days = new Set<string>()
  for (const w of finished) {
    const at = new Date(w.startedAt)
    const hour = at.getHours()
    if (hour < 7) earlyWorkouts += 1
    if (hour >= 21) lateWorkouts += 1
    const weekday = at.getDay()
    if (weekday === 0 || weekday === 6) weekendWorkouts += 1
    days.add(dayKey(w.startedAt))

    const seconds = Math.max(0, ((w.endedAt as number) - w.startedAt) / 1000)
    // Ignore absurd durations from a session left open overnight, so "longest
    // workout" stays a real number rather than a forgotten timer.
    if (seconds <= 6 * 3600) {
      totalTrainingSeconds += seconds
      if (seconds > longestWorkoutSeconds) longestWorkoutSeconds = seconds
    }
  }


  const finishedById = new Map(finished.map((w) => [w.id, w]))
  const exerciseById = new Map(exercises.flatMap((ex) => (ex ? [[ex.id, ex] as const] : [])))
  const weById = new Map(allWe.map((we) => [we.id, we]))
  const sessions = new Map<string, SessionRecordValues>()
  for (const set of allSets) {
    const we = weById.get(set.workoutExerciseId)
    const workout = we && finishedById.get(we.workoutId)
    const exercise = we && exerciseById.get(we.exerciseId)
    if (!we || !workout || !exercise) continue
    const id = `${workout.id}:${we.exerciseId}:${we.equipment}`
    const session = sessions.get(id) ?? {
      key: `${we.exerciseId}:${we.equipment}`,
      at: workout.startedAt,
      values: {},
    }
    const effective = effectiveWeightKg(set, exercise, workout.bodyweightKg, we.loadMode)
    for (const [type, value] of Object.entries(progressRecordValues(set, effective)) as [
      RecordType,
      number,
    ][]) {
      session.values[type] = Math.max(session.values[type] ?? 0, value)
    }
    sessions.set(id, session)
  }
  const recordSessions = countRecordBreakingSessions([...sessions.values()])

  const profile = await getProfile()

  return {
    bestSquatE1rmKg: bestE1rmByExercise.get(BIG_THREE.squat) ?? 0,
    bestBenchE1rmKg: bestE1rmByExercise.get(BIG_THREE.bench) ?? 0,
    bestDeadliftE1rmKg: bestE1rmByExercise.get(BIG_THREE.deadlift) ?? 0,
    bestAnyE1rmKg,
    bestOverheadPressE1rmKg: bestE1rmByExercise.get(BADGE_LIFTS.overheadPress) ?? 0,
    bestRowE1rmKg: bestE1rmByExercise.get(BADGE_LIFTS.row) ?? 0,
    bestPullUpE1rmKg: bestE1rmByExercise.get(BADGE_LIFTS.pullUp) ?? 0,
    bestDipE1rmKg: bestE1rmByExercise.get(BADGE_LIFTS.dip) ?? 0,
    totalCardioMeters,
    totalCardioSeconds,
    distinctExercises: distinctExercises.size,
    distinctRegions: distinctRegions.size,
    totalReps,
    totalBodyweightReps,
    maxRepsInSet,
    maxSetWeightKg,
    totalDaysTrained: days.size,
    bestDayStreak: dayStreaks(days).best,
    earlyWorkouts,
    lateWorkouts,
    weekendWorkouts,
    recordSessions,
    totalTrainingSeconds,
    longestWorkoutSeconds,
    bodyweightKg: profile.bodyweightCacheKg ?? 0,
  }
}

// Feeds the AI coach (§13); the privacy contract lives in buildCoachSummary, which
// never sees a name, note, or absolute date.

export async function getCoachSummary(): Promise<CoachSummary> {
  const profile = await getProfile()

  const cutoff = Date.now() - SUMMARY_WEEKS * WEEK_MS
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

  const { workoutExercises, sets, exercisesById } = await loadWorkoutRows(workouts)
  const setsByWe = groupBy(
    sets.filter((s) => s.isCompleted),
    (s) => s.workoutExerciseId,
  )
  const weByWorkout = groupBy(workoutExercises, (we) => we.workoutId)

  const sessions: SummarySession[] = workouts.map((w) => {
    const offset = weekOffset(w.startedAt, profile.weekStartsOn)
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
          trackingType: exercise.trackingType,
          bodyweightFactor: exercise.bodyweightFactor,
          loadMode: we.loadMode,
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
    return { weekOffset: offset, bodyweightKg: w.bodyweightKg, exercises: exerciseInstances }
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
  return `${plural(working.length, 'set')}${repPart}${weightPart}`
}
