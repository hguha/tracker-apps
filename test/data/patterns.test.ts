import { describe, expect, it } from 'vitest'
import {
  bucketByDayOfWeek,
  bucketByHour,
  computeTrainingPatterns,
  sessionGapsDays,
} from '@/data/patterns'

// Local noon avoids the day-shift a UTC-midnight parse would cause under a
// negative-offset timezone.
const at = (isoDate: string) => Date.parse(`${isoDate}T12:00:00`)

describe('patterns', () => {
  // 2024-06-10 Mon, 2024-06-12 Wed, 2024-06-17 Mon.
  const starts = [at('2024-06-10'), at('2024-06-12'), at('2024-06-17')]

  it('buckets by day of week (0=Sun)', () => {
    const counts = bucketByDayOfWeek(starts)
    expect(counts[1]).toBe(2) // Monday ×2
    expect(counts[3]).toBe(1) // Wednesday ×1
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('buckets by hour', () => {
    const counts = bucketByHour(starts)
    expect(counts[12]).toBe(3)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('computes whole-day gaps between consecutive sessions, unsorted-safe', () => {
    expect(sessionGapsDays([starts[2]!, starts[0]!, starts[1]!])).toEqual([2, 5])
  })

  it('summarizes cadence', () => {
    const p = computeTrainingPatterns(starts)
    expect(p.totalSessions).toBe(3)
    expect(p.medianRestDays).toBe(3.5) // median of [2, 5]
    expect(p.busiestDay).toBe(1) // Monday
    expect(p.busiestHour).toBe(12)
    // 3 sessions over a 7-day span → 3/week.
    expect(p.sessionsPerWeek).toBeCloseTo(3, 5)
  })

  it('is empty-safe', () => {
    const p = computeTrainingPatterns([])
    expect(p.totalSessions).toBe(0)
    expect(p.medianRestDays).toBeNull()
    expect(p.sessionsPerWeek).toBeNull()
    expect(p.busiestDay).toBeNull()
  })
})
