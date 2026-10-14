import { describe, expect, it } from 'vitest'
import { parseDuration } from '@/features/workout/SetRow'

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
