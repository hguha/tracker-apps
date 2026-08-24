import { describe, expect, it } from 'vitest'
import {
  camelToSnake,
  isoToMs,
  keysToCamel,
  keysToSnake,
  msToIso,
  snakeToCamel,
  tableToPostgres,
} from '../src/columnCase'

describe('column case conversion', () => {
  it('round-trips a key through camel↔snake', () => {
    for (const key of ['weightKg', 'workoutExerciseId', 'restTakenSeconds', 'id', 'rpe']) {
      expect(snakeToCamel(camelToSnake(key))).toBe(key)
    }
  })

  it('handles digits in a boundary correctly', () => {
    expect(camelToSnake('p256dh')).toBe('p256dh')
    expect(snakeToCamel('reps_left')).toBe('repsLeft')
  })

  it('converts a whole row both ways', () => {
    const domain = { workoutExerciseId: 'x', weightKg: 100, isCompleted: true }
    const snake = keysToSnake(domain)
    expect(snake).toEqual({ workout_exercise_id: 'x', weight_kg: 100, is_completed: true })
    expect(keysToCamel(snake)).toEqual(domain)
  })

  it('maps a store name to its Postgres table', () => {
    expect(tableToPostgres('workoutExercises')).toBe('workout_exercises')
    expect(tableToPostgres('sets')).toBe('sets')
    expect(tableToPostgres('personalRecords')).toBe('personal_records')
  })

  it('round-trips a timestamp through ms↔iso', () => {
    const ms = 1_700_000_000_000
    expect(isoToMs(msToIso(ms))).toBe(ms)
    expect(msToIso(null)).toBeNull()
    expect(isoToMs(null)).toBeNull()
  })
})
