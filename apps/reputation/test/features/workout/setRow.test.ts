import { describe, expect, it } from 'vitest'
import { hasLoggedValues, parseDuration, parseSetValue } from '@/features/workout/SetRow'
import { setHasValues } from '@/data/repository'
import type { WorkoutSet } from '@/domain/types'

describe('parseDuration', () => {
  it('reads seconds, m:ss and h:mm:ss', () => {
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('1:00:05')).toBe(3605)
    expect(parseDuration('  ')).toBeNull()
  })

  it('treats a negative duration as no value', () => {
    expect(parseDuration('-30')).toBeNull()
    expect(parseDuration('1:-30')).toBeNull()
  })
})

describe('parseSetValue', () => {
  it('reads a typed number and treats blank, junk or negative as no value', () => {
    expect(parseSetValue('12.5')).toBe(12.5)
    expect(parseSetValue('')).toBeNull()
    expect(parseSetValue('abc')).toBeNull()
    expect(parseSetValue('-5')).toBeNull()
  })
})

describe('hasLoggedValues', () => {
  it('shows a weight-only carry as logged, matching what the data layer stores', () => {
    const set = {
      weightKg: 40,
      reps: null,
      durationSeconds: null,
      distanceM: null,
    } as WorkoutSet
    const carry = { trackingType: 'weight_time' } as const
    expect(setHasValues(set, carry)).toBe(true)
    expect(hasLoggedValues(set, carry)).toBe(true)
  })
})
