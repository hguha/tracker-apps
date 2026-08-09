/**
 * The single aggregation pass behind every chart on the Insights tab (§9.0).
 *
 * One pass, one filter scope. Charts receive slices of this rather than querying
 * independently, which is what guarantees two charts on the same screen describe
 * the same data — the failure mode §9.0 forbids.
 */

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import * as repo from '@/data/repository'
import {
  bestOneRepMaxKg,
  isWorkingSet,
  topSetWeightKg,
  volumeLoadKg,
} from '@/lib/metrics'
import { weekKey, weekStart } from '@/lib/dates'
import { format } from 'date-fns'
import type { Profile, Region, WorkoutSet } from '@/domain/types'

export interface InsightsFilters {
  /** Weeks of history to include. */
  weeks: number
  /** Empty means all regions. */
  regions: string[]
  /** Empty means all exercises. */
  exerciseIds: string[]
}

export interface SessionPoint {
  workoutId: string
  at: number
  volumeKg: number
  setCount: number
  durationSeconds: number | null
  regions: Region[]
}

export interface ExerciseSeries {
  exerciseId: string
  name: string
  points: {
    at: number
    e1rmKg: number | null
    topSetKg: number | null
    volumeKg: number
    repRange: [number, number] | null
  }[]
}

export interface InsightsData {
  profile: Profile
  /** Every week in range, including empty ones, so a gap reads as a gap. */
  weeks: string[]
  volumeByWeek: Map<string, number>
  setsByWeek: Map<string, number>
  workoutsByWeek: Map<string, number>
  volumeByRegion: Map<Region, number>
  setsByRegion: Map<Region, number>
  /** Working sets per movement pattern (C-25) and per equipment (C-26). */
  setsByPattern: Map<string, number>
  setsByEquipment: Map<string, number>
  regionVolumeByWeek: Map<string, Map<Region, number>>
  /** Per-exercise progression, only for exercises with data in range. */
  exerciseSeries: ExerciseSeries[]
  sessions: SessionPoint[]
  /** Rep-bucket distribution: how the training is actually distributed. */
  repBuckets: Map<string, number>
  dayOfWeekCounts: number[]
  /** Session start hour, 0–23, for the time-of-day histogram (D-37). */
  hourCounts: number[]
  /** Volume per calendar day (yyyy-MM-dd), for the training-calendar heatmap (A-3). */
  volumeByDay: Map<string, number>
  /** Every exercise trained ever, for the filter sheet. */
  exerciseOptions: { id: string; name: string; region: Region | undefined }[]
  bodyMetrics: Map<string, { at: number; value: number }[]>
  workoutCount: number
  totalVolumeKg: number
  totalSets: number
  cardioSeconds: number
  cardioMeters: number
}

/** Ordered buckets for the rep-range distribution. Ordinal, not categorical. */
export const REP_BUCKETS = ['1-5', '6-8', '9-12', '13-20', '20+'] as const

function repBucket(reps: number): string {
  if (reps <= 5) return '1-5'
  if (reps <= 8) return '6-8'
  if (reps <= 12) return '9-12'
  if (reps <= 20) return '13-20'
  return '20+'
}

export function useInsightsData(filters: InsightsFilters): InsightsData | undefined {
  return useLiveQuery(async () => {
    const profile = await repo.getProfile()
    const muscles = await db.muscles.toArray()
    const regionOf = new Map(muscles.map((m) => [m.id, m.region]))

    const cutoff = Date.now() - filters.weeks * 7 * 24 * 3600 * 1000
    const allWorkouts = (await repo.listWorkouts(500)).filter((w) => w.endedAt !== null)
    const workouts = allWorkouts.filter((w) => w.startedAt >= cutoff)

    const regionFilter = new Set(filters.regions)
    const exerciseFilter = new Set(filters.exerciseIds)

    const volumeByWeek = new Map<string, number>()
    const setsByWeek = new Map<string, number>()
    const workoutsByWeek = new Map<string, number>()
    const volumeByRegion = new Map<Region, number>()
    const setsByRegion = new Map<Region, number>()
    const setsByPattern = new Map<string, number>()
    const setsByEquipment = new Map<string, number>()
    const regionVolumeByWeek = new Map<string, Map<Region, number>>()
    const repBuckets = new Map<string, number>()
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]
    const hourCounts = new Array<number>(24).fill(0)
    const volumeByDay = new Map<string, number>()
    const sessions: SessionPoint[] = []
    const seriesByExercise = new Map<string, ExerciseSeries>()
    const exerciseOptions = new Map<
      string,
      { id: string; name: string; region: Region | undefined }
    >()

    let totalVolumeKg = 0
    let totalSets = 0
    let cardioSeconds = 0
    let cardioMeters = 0

    // Filter options come from all history, not the filtered range — otherwise
    // narrowing the range would hide the very filter needed to widen it again.
    for (const workout of allWorkouts) {
      for (const we of await repo.listWorkoutExercises(workout.id)) {
        if (exerciseOptions.has(we.exerciseId)) continue
        const exercise = await db.exercises.get(we.exerciseId)
        if (!exercise) continue
        exerciseOptions.set(we.exerciseId, {
          id: exercise.id,
          name: exercise.name,
          region: regionOf.get(exercise.primaryMuscleId),
        })
      }
    }

    for (const workout of workouts) {
      const key = weekKey(workout.startedAt, profile.weekStartsOn)
      const workoutExercises = await repo.listWorkoutExercises(workout.id)

      let sessionVolume = 0
      let sessionSets = 0
      const sessionRegions = new Set<Region>()
      let matchedFilter = false

      for (const we of workoutExercises) {
        const exercise = await db.exercises.get(we.exerciseId)
        if (!exercise) continue

        const region = regionOf.get(exercise.primaryMuscleId)
        if (regionFilter.size > 0 && (!region || !regionFilter.has(region))) continue
        if (exerciseFilter.size > 0 && !exerciseFilter.has(exercise.id)) continue
        matchedFilter = true

        const sets = (await repo.listSets(we.id)).filter((s) => s.isCompleted)
        if (sets.length === 0) continue

        const working = sets.filter((s) => isWorkingSet(s))
        const exerciseVolume = volumeLoadKg(sets, exercise, workout.bodyweightKg)

        sessionVolume += exerciseVolume
        sessionSets += working.length
        totalVolumeKg += exerciseVolume
        totalSets += working.length

        volumeByWeek.set(key, (volumeByWeek.get(key) ?? 0) + exerciseVolume)
        setsByWeek.set(key, (setsByWeek.get(key) ?? 0) + working.length)

        if (exercise.movementPattern === 'cardio') {
          cardioSeconds += sets.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
          cardioMeters += sets.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)
        }

        for (const set of working) {
          if (set.reps !== null) {
            const bucket = repBucket(set.reps)
            repBuckets.set(bucket, (repBuckets.get(bucket) ?? 0) + 1)
          }
        }

        // Region-level views attribute to the exercise's *single primary*
        // region, not spread across secondaries. Crediting "back" for a back
        // squat (via the erectors it works secondarily) is technically true
        // but reads as noise on a body-part chart. Secondary-muscle spreading
        // is kept for the muscle-level volume analysis, where partial credit
        // is the point (§4.3); here, one lift → one body part.
        if (region) {
          volumeByRegion.set(region, (volumeByRegion.get(region) ?? 0) + exerciseVolume)
          const weekMap = regionVolumeByWeek.get(key) ?? new Map<Region, number>()
          weekMap.set(region, (weekMap.get(region) ?? 0) + exerciseVolume)
          regionVolumeByWeek.set(key, weekMap)
        }

        if (region) {
          sessionRegions.add(region)
          setsByRegion.set(region, (setsByRegion.get(region) ?? 0) + working.length)
        }

        // Pattern and equipment coverage, counted in working sets.
        setsByPattern.set(
          exercise.movementPattern,
          (setsByPattern.get(exercise.movementPattern) ?? 0) + working.length,
        )
        setsByEquipment.set(
          exercise.equipment,
          (setsByEquipment.get(exercise.equipment) ?? 0) + working.length,
        )

        const series =
          seriesByExercise.get(exercise.id) ??
          ({ exerciseId: exercise.id, name: exercise.name, points: [] } as ExerciseSeries)
        series.points.push({
          at: workout.startedAt,
          e1rmKg: bestOneRepMaxKg(sets),
          topSetKg: topSetWeightKg(sets),
          volumeKg: exerciseVolume,
          repRange: computeRepRange(working),
        })
        seriesByExercise.set(exercise.id, series)
      }

      if (!matchedFilter) continue

      workoutsByWeek.set(key, (workoutsByWeek.get(key) ?? 0) + 1)
      const started = new Date(workout.startedAt)
      dayOfWeekCounts[started.getDay()]! += 1
      hourCounts[started.getHours()]! += 1
      const dayKey = format(workout.startedAt, 'yyyy-MM-dd')
      volumeByDay.set(dayKey, (volumeByDay.get(dayKey) ?? 0) + sessionVolume)
      sessions.push({
        workoutId: workout.id,
        at: workout.startedAt,
        volumeKg: sessionVolume,
        setCount: sessionSets,
        durationSeconds:
          workout.endedAt !== null ? (workout.endedAt - workout.startedAt) / 1000 : null,
        regions: [...sessionRegions],
      })
    }

    // Contiguous weeks, so a missing week reads as a gap rather than vanishing.
    const weeks: string[] = []
    if (sessions.length > 0) {
      const earliest = Math.min(...sessions.map((s) => s.at))
      let cursor = weekStart(earliest, profile.weekStartsOn)
      const end = weekStart(Date.now(), profile.weekStartsOn)
      while (cursor <= end) {
        weeks.push(format(cursor, 'yyyy-MM-dd'))
        cursor += 7 * 24 * 3600 * 1000
      }
    }

    const bodyMetrics = new Map<string, { at: number; value: number }[]>()
    for (const key of ['bodyweight', 'body_fat_pct', 'waist', 'resting_hr']) {
      const entries = await repo.listMetricEntries(key, 400)
      const inRange = entries
        .filter((e) => e.measuredAt >= cutoff)
        .map((e) => ({ at: e.measuredAt, value: e.value }))
        .sort((a, b) => a.at - b.at)
      if (inRange.length > 0) bodyMetrics.set(key, inRange)
    }

    const exerciseSeries = [...seriesByExercise.values()]
      .map((series) => ({
        ...series,
        points: [...series.points].sort((a, b) => a.at - b.at),
      }))
      .sort((a, b) => b.points.length - a.points.length)

    return {
      profile,
      weeks,
      volumeByWeek,
      setsByWeek,
      workoutsByWeek,
      volumeByRegion,
      setsByRegion,
      setsByPattern,
      setsByEquipment,
      regionVolumeByWeek,
      exerciseSeries,
      sessions: sessions.sort((a, b) => a.at - b.at),
      repBuckets,
      dayOfWeekCounts,
      hourCounts,
      volumeByDay,
      exerciseOptions: [...exerciseOptions.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      bodyMetrics,
      workoutCount: sessions.length,
      totalVolumeKg,
      totalSets,
      cardioSeconds,
      cardioMeters,
    }
  }, [filters.weeks, filters.regions.join(), filters.exerciseIds.join()])
}

function computeRepRange(sets: WorkoutSet[]): [number, number] | null {
  const reps = sets.map((s) => s.reps).filter((r): r is number => r !== null)
  if (reps.length === 0) return null
  return [Math.min(...reps), Math.max(...reps)]
}
