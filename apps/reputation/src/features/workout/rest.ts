import { isCardioPattern } from '@/domain/movement'
import type { Exercise, Profile, WorkoutExercise } from '@/domain/types'

export interface RestRow {
  workoutExercise: Pick<WorkoutExercise, 'restSeconds'>
  exercise: Pick<Exercise, 'defaultRestSeconds' | 'movementPattern'> | undefined
}

type RestProfile = Pick<Profile, 'defaultRestSeconds'>

export function restSecondsFor(row: RestRow, profile: RestProfile): number {
  return (
    row.workoutExercise.restSeconds ??
    row.exercise?.defaultRestSeconds ??
    profile.defaultRestSeconds
  )
}

// The last non-cardio exercise is the one just trained; fall back to the default.
export function lastLiftRestSeconds(rows: RestRow[], profile: RestProfile): number {
  const lastLift = [...rows]
    .reverse()
    .find((r) => r.exercise && !isCardioPattern(r.exercise.movementPattern))
  return lastLift ? restSecondsFor(lastLift, profile) : profile.defaultRestSeconds
}
