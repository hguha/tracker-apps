// Privacy contract (§13, §2): the summary sent to the coach must never carry raw
// rows or anything identifying — only week-offset aggregates, no names/notes/dates.

import type { Equipment, MovementPattern, Region } from '@/domain/types'
import { estimatedOneRepMaxKg } from '@/lib/metrics'
import { displayWeightOrNull } from '@/lib/units'

export const SUMMARY_WEEKS = 12

/** Bump when the shape changes, so a server prompt can branch if needed. */
export const SUMMARY_VERSION = 2

export interface SummarySet {
  weightKg: number | null
  reps: number | null
  rpe: number | null
  durationSeconds: number | null
  distanceM: number | null
}

export interface SummaryExerciseInstance {
  exerciseId: string
  name: string
  region: Region | undefined
  pattern: MovementPattern
  equipment: Equipment
  isCardio: boolean
  sets: SummarySet[]
}

export interface SummarySession {
  /** Week offset from the current week: 0 = this week, −1 = last week, … */
  weekOffset: number
  exercises: SummaryExerciseInstance[]
}

export interface SummaryInput {
  unitWeight: 'lb' | 'kg'
  unitLength: 'in' | 'cm'
  weeklyWorkoutGoal: number
  bodyweightKg: number | null
  heightCm: number | null
  /** The one free-text field that leaves the device — surfaced in the §13 disclosure. */
  trainingGoal: string
  sessions: SummarySession[]
}

export interface WeekAgg {
  weekOffset: number
  workouts: number
  sets: number
  volumeKg: number
}

export interface ExerciseAgg {
  name: string
  region: Region | undefined
  pattern: MovementPattern
  equipment: Equipment
  sessions: number
  totalSets: number
  bestE1rmKg: number | null
  recentTopSetKg: number | null
  /** [min, max] across logged sets, or null. */
  repRange: [number, number] | null
  lastWeekOffset: number
}

export interface CoachSummary {
  version: number
  unitWeight: 'lb' | 'kg'
  weeklyWorkoutGoal: number
  bodyweight: number | null
  height: number | null
  heightUnit: 'in' | 'cm'
  trainingGoal: string
  weeksCovered: number
  totalWorkouts: number
  /** Per-week rollup, most recent first. */
  weeks: WeekAgg[]
  /** Working sets per region over the window, most-trained first. */
  regionSets: { region: Region; sets: number }[]
  /** Per-exercise rollup, most-trained first. */
  exercises: ExerciseAgg[]
}

// Whether a row is non-empty — not the canonical volume predicate (metrics.isWorkingSet).
function hasValue(s: SummarySet): boolean {
  return s.reps !== null || s.durationSeconds !== null || s.distanceM !== null
}

/** Σ weight×reps; bodyweight/cardio contribute nothing here. */
function volumeOf(sets: SummarySet[]): number {
  let total = 0
  for (const s of sets) {
    if (s.weightKg !== null && s.reps !== null) total += s.weightKg * s.reps
  }
  return total
}

export function buildCoachSummary(input: SummaryInput): CoachSummary {
  const { sessions } = input

  const weekMap = new Map<number, WeekAgg>()
  const regionMap = new Map<Region, number>()
  const exMap = new Map<
    string,
    {
      name: string
      region: Region | undefined
      pattern: MovementPattern
      equipment: Equipment
      isCardio: boolean
      sessions: number
      totalSets: number
      bestE1rmKg: number | null
      recentTopSetKg: number | null
      recentWeek: number
      repMin: number | null
      repMax: number | null
    }
  >()

  for (const session of sessions) {
    const week = weekMap.get(session.weekOffset) ?? {
      weekOffset: session.weekOffset,
      workouts: 0,
      sets: 0,
      volumeKg: 0,
    }
    week.workouts += 1

    for (const ex of session.exercises) {
      const working = ex.sets.filter(hasValue)
      if (working.length === 0) continue

      week.sets += working.length
      week.volumeKg += volumeOf(working)
      if (ex.region)
        regionMap.set(ex.region, (regionMap.get(ex.region) ?? 0) + working.length)

      const acc = exMap.get(ex.exerciseId) ?? {
        name: ex.name,
        region: ex.region,
        pattern: ex.pattern,
        equipment: ex.equipment,
        isCardio: ex.isCardio,
        sessions: 0,
        totalSets: 0,
        bestE1rmKg: null as number | null,
        recentTopSetKg: null as number | null,
        recentWeek: -Infinity,
        repMin: null as number | null,
        repMax: null as number | null,
      }
      acc.sessions += 1
      acc.totalSets += working.length

      for (const s of working) {
        const e1rm = estimatedOneRepMaxKg(s.weightKg, s.reps)
        if (e1rm !== null && (acc.bestE1rmKg === null || e1rm > acc.bestE1rmKg)) {
          acc.bestE1rmKg = e1rm
        }
        if (s.reps !== null) {
          acc.repMin = acc.repMin === null ? s.reps : Math.min(acc.repMin, s.reps)
          acc.repMax = acc.repMax === null ? s.reps : Math.max(acc.repMax, s.reps)
        }
      }

      // Most recent session's heaviest set: a later week (offset closer to 0) wins.
      if (session.weekOffset >= acc.recentWeek) {
        const topThisSession = Math.max(
          ...working.map((s) => s.weightKg ?? -Infinity),
          acc.recentWeek === session.weekOffset
            ? (acc.recentTopSetKg ?? -Infinity)
            : -Infinity,
        )
        acc.recentTopSetKg = Number.isFinite(topThisSession) ? topThisSession : null
        acc.recentWeek = session.weekOffset
      }

      exMap.set(ex.exerciseId, acc)
    }

    weekMap.set(session.weekOffset, week)
  }

  const round = (kg: number | null): number | null =>
    kg === null ? null : Math.round(kg * 10) / 10

  const exercises: ExerciseAgg[] = [...exMap.values()]
    .map((a) => ({
      name: a.name,
      region: a.region,
      pattern: a.pattern,
      equipment: a.equipment,
      sessions: a.sessions,
      totalSets: a.totalSets,
      bestE1rmKg: round(a.bestE1rmKg),
      recentTopSetKg: round(a.recentTopSetKg),
      repRange:
        a.repMin !== null && a.repMax !== null
          ? ([a.repMin, a.repMax] as [number, number])
          : null,
      lastWeekOffset: a.recentWeek,
    }))
    .sort((a, b) => b.totalSets - a.totalSets)

  const weeks = [...weekMap.values()]
    .map((w) => ({ ...w, volumeKg: Math.round(w.volumeKg) }))
    .sort((a, b) => b.weekOffset - a.weekOffset)

  const regionSets = [...regionMap.entries()]
    .map(([region, sets]) => ({ region, sets }))
    .sort((a, b) => b.sets - a.sets)

  // Stored metric; express in the user's units so the coach reads them as they do.
  const bodyweight = displayWeightOrNull(input.bodyweightKg, input.unitWeight)
  const height =
    input.heightCm === null
      ? null
      : input.unitLength === 'in'
        ? Math.round((input.heightCm / 2.54) * 10) / 10
        : Math.round(input.heightCm)

  return {
    version: SUMMARY_VERSION,
    unitWeight: input.unitWeight,
    weeklyWorkoutGoal: input.weeklyWorkoutGoal,
    bodyweight,
    height,
    heightUnit: input.unitLength,
    trainingGoal: input.trainingGoal.trim(),
    weeksCovered: SUMMARY_WEEKS,
    totalWorkouts: sessions.length,
    weeks,
    regionSets,
    exercises,
  }
}
