// The context bundle the conversational coach receives each turn. Unlike the old
// de-identified CoachSummary (§13), this carries dated history, the templates the
// user already has, and — mid-workout — the live session, by explicit user choice
// (see the "What's sent" disclosure). Deep/open-ended lookups are served on demand
// by the retrieval tools (tools.ts) rather than dumped here, so this stays bounded.

import * as repo from '@/data/repository'
import { computeTrainingPatterns } from '@/data/patterns'
import { composeExerciseName } from '@/lib/labels'
import { weekOffset } from '@/lib/dates'
import { displayWeight, displayWeightOrNull, formatWeight, lengthFromCm } from '@/lib/units'
import type { WeightUnit } from '@/domain/types'

export const COACH_CONTEXT_VERSION = 1

// How much dated history to inline; older/broader lookups go through findWorkouts.
// Kept small so the per-message payload (and model prefill latency) stays lean.
const RECENT_WORKOUTS = 10

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface CoachContextExercise {
  name: string
  equipment: string
  loadMode: string | null
  // Logged working values, compact: "60kg×8", "bw×12", "12min".
  sets: string[]
}

export interface CoachContext {
  version: number
  now: string
  profile: {
    name: string
    unitWeight: WeightUnit
    sex: 'male' | 'female' | null
    age: number | null
    experienceLevel: 'beginner' | 'intermediate' | 'advanced' | null
    trainingDaysPerWeek: number | null
    weeklyWorkoutGoal: number
    bodyweight: number | null
    height: number | null
    heightUnit: 'in' | 'cm'
    trainingGoal: string
  }
  patterns: {
    totalSessions: number
    sessionsPerWeek: number | null
    medianRestDays: number | null
    busiestDay: string | null
    busiestHour: number | null
    byDay: { day: string; count: number }[]
  }
  // Best estimated 1RM per lift, user units, strongest first.
  keyLifts: { name: string; e1rm: number }[]
  // Working sets per body region over the recent window, most-trained first.
  regionSets: { region: string; sets: number }[]
  // Per-week totals (recent first, weekOffset 0 = this week) in the user's unit, so
  // the coach can judge whether a week's volume is high or low for THIS user.
  weeklyVolume: { weekOffset: number; workouts: number; sets: number; volume: number }[]
  templates: {
    id: string
    name: string
    exercises: { name: string; target: string }[]
  }[]
  recentWorkouts: {
    date: string
    title: string
    // Session volume in the user's unit (weight × reps), not kg.
    volume: number
    setCount: number
    exercises: string[]
  }[]
  // Present only when the coach is opened mid-workout (§ in-workout coach).
  activeWorkout?: {
    title: string
    startedAgoMinutes: number
    exercises: CoachContextExercise[]
  }
}

function compactSet(
  set: { weightKg: number | null; reps: number | null; durationSeconds: number | null; distanceM: number | null },
  unit: WeightUnit,
): string {
  if (set.durationSeconds !== null) {
    const mins = Math.round(set.durationSeconds / 60)
    return set.distanceM !== null && set.distanceM > 0
      ? `${mins}min·${Math.round(set.distanceM)}m`
      : `${mins}min`
  }
  const reps = set.reps ?? 0
  const load = set.weightKg === null ? 'bw' : formatWeight(set.weightKg, unit)
  return `${load}×${reps}`
}

export async function buildCoachContext(
  opts: { includeActiveWorkout?: boolean } = {},
): Promise<CoachContext> {
  const profile = await repo.getProfile()
  const unit = profile.unitWeight

  // Reuse the aggregate rollup for key lifts + region sets, but NOT for volume —
  // its volume ignores bodyweight/loadMode work (§ discrepancy). Weekly and per-
  // workout volume come from the workout summaries, which use volumeLoadKg, so the
  // coach's numbers match Home and Insights.
  const [summary, finishedSummaries, templates] = await Promise.all([
    repo.getCoachSummary(),
    repo.listFinishedWorkoutSummaries(150),
    repo.listTemplates(),
  ])

  const finished = (await repo.listWorkouts(500)).filter((w) => w.endedAt !== null)
  const patterns = computeTrainingPatterns(finished)

  // Key lifts from the aggregate rollup (already de-duped, strongest-first by e1RM).
  const keyLifts = summary.exercises
    .filter((e) => e.bestE1rmKg !== null)
    .slice(0, 8)
    .map((e) => ({ name: e.name, e1rm: displayWeightOrNull(e.bestE1rmKg, unit) ?? 0 }))
    .filter((l) => l.e1rm > 0)

  const templateDigests = await Promise.all(
    templates.map(async (t) => {
      const exercises = await repo.listTemplateExercises(t.id)
      const rows = await Promise.all(
        exercises.map(async (te) => {
          const exercise = await repo.getExercise(te.exerciseId)
          return {
            name: composeExerciseName(exercise?.name ?? te.exerciseId, te.equipment),
            target: repo.describeTemplateTarget(te, unit),
          }
        }),
      )
      return { id: t.id, name: t.name, exercises: rows }
    }),
  )

  const recentWorkouts = finishedSummaries.slice(0, RECENT_WORKOUTS).map((s) => ({
    date: new Date(s.workout.startedAt).toISOString().slice(0, 10),
    title: s.title,
    volume: Math.round(displayWeight(s.volumeKg, unit)),
    setCount: s.setCount,
    exercises: s.exerciseNames,
  }))

  // Per-week totals aggregated from the same volumeLoadKg-based summaries as Home,
  // grouped by the user's week start so "this week" (offset 0) lines up with the app.
  const weekTotals = new Map<number, { workouts: number; sets: number; volumeKg: number }>()
  for (const s of finishedSummaries) {
    const offset = weekOffset(s.workout.startedAt, profile.weekStartsOn)
    const agg = weekTotals.get(offset) ?? { workouts: 0, sets: 0, volumeKg: 0 }
    agg.workouts += 1
    agg.sets += s.setCount
    agg.volumeKg += s.volumeKg
    weekTotals.set(offset, agg)
  }
  const weeklyVolume = [...weekTotals.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([offset, agg]) => ({
      weekOffset: offset,
      workouts: agg.workouts,
      sets: agg.sets,
      volume: Math.round(displayWeight(agg.volumeKg, unit)),
    }))

  const context: CoachContext = {
    version: COACH_CONTEXT_VERSION,
    now: new Date().toISOString().slice(0, 10),
    profile: {
      name: profile.displayName,
      unitWeight: unit,
      sex: profile.sex,
      age: profile.birthYear === null ? null : new Date().getFullYear() - profile.birthYear,
      experienceLevel: profile.experienceLevel,
      trainingDaysPerWeek: profile.trainingDaysPerWeek,
      weeklyWorkoutGoal: profile.weeklyWorkoutGoal,
      bodyweight: displayWeightOrNull(profile.bodyweightCacheKg, unit),
      height:
        profile.heightCm === null
          ? null
          : Math.round(lengthFromCm(profile.heightCm, profile.unitLength) * 10) / 10,
      heightUnit: profile.unitLength,
      trainingGoal: profile.trainingGoal ?? '',
    },
    patterns: {
      totalSessions: patterns.totalSessions,
      sessionsPerWeek:
        patterns.sessionsPerWeek === null
          ? null
          : Math.round(patterns.sessionsPerWeek * 10) / 10,
      medianRestDays: patterns.medianRestDays,
      busiestDay: patterns.busiestDay === null ? null : DAY_NAMES[patterns.busiestDay]!,
      busiestHour: patterns.busiestHour,
      byDay: patterns.dayOfWeekCounts.map((count, i) => ({ day: DAY_NAMES[i]!, count })),
    },
    keyLifts,
    regionSets: summary.regionSets.map((r) => ({ region: r.region, sets: r.sets })),
    weeklyVolume,
    templates: templateDigests,
    recentWorkouts,
  }

  if (opts.includeActiveWorkout) {
    const active = await repo.getActiveWorkout()
    if (active) {
      const workoutExercises = await repo.listWorkoutExercises(active.id)
      const exercises: CoachContextExercise[] = []
      for (const we of workoutExercises) {
        const exercise = await repo.getExercise(we.exerciseId)
        if (!exercise) continue
        const sets = (await repo.listSets(we.id)).filter((s) => s.isCompleted)
        exercises.push({
          name: exercise.name,
          equipment: we.equipment,
          loadMode: we.loadMode,
          sets: sets.map((s) => compactSet(s, unit)),
        })
      }
      context.activeWorkout = {
        title: active.title || 'Current workout',
        startedAgoMinutes: Math.round((Date.now() - active.startedAt) / 60000),
        exercises,
      }
    }
  }

  return context
}
