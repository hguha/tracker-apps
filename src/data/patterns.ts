// Training-cadence math over session timestamps (day-of-week, time-of-day, rest
// gaps), shared by the insights charts and the coach so it's derived one way.

import type { Workout } from '@/domain/types'
import { DAY_MS } from '@/lib/dates'

export interface TrainingPatterns {
  totalSessions: number
  // Length 7, index 0 = Sunday (matches Date.getDay()).
  dayOfWeekCounts: number[]
  // Length 24, index = local start hour.
  hourCounts: number[]
  // Days between each pair of consecutive sessions, chronological.
  restDayGaps: number[]
  medianRestDays: number | null
  // Sessions per week averaged over the span from first to last session.
  sessionsPerWeek: number | null
  // The single most-frequent day (0–6) / hour (0–23), or null with no data.
  busiestDay: number | null
  busiestHour: number | null
}

export function bucketByDayOfWeek(starts: number[]): number[] {
  const counts = new Array<number>(7).fill(0)
  for (const at of starts) counts[new Date(at).getDay()]! += 1
  return counts
}

export function bucketByHour(starts: number[]): number[] {
  const counts = new Array<number>(24).fill(0)
  for (const at of starts) counts[new Date(at).getHours()]! += 1
  return counts
}

// Whole-day gaps between consecutive sessions (input need not be pre-sorted).
export function sessionGapsDays(starts: number[]): number[] {
  const sorted = [...starts].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(Math.round((sorted[i]! - sorted[i - 1]!) / DAY_MS))
  }
  return gaps
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function argmax(counts: number[]): number | null {
  let best = -1
  let bestIndex: number | null = null
  counts.forEach((count, index) => {
    if (count > best) {
      best = count
      bestIndex = index
    }
  })
  return best > 0 ? bestIndex : null
}

// Accepts either finished workouts or raw start timestamps.
export function computeTrainingPatterns(
  input: Workout[] | number[],
): TrainingPatterns {
  const starts = input.map((w) => (typeof w === 'number' ? w : w.startedAt))
  const dayOfWeekCounts = bucketByDayOfWeek(starts)
  const hourCounts = bucketByHour(starts)
  const restDayGaps = sessionGapsDays(starts)

  let sessionsPerWeek: number | null = null
  if (starts.length >= 2) {
    const spanDays = (Math.max(...starts) - Math.min(...starts)) / DAY_MS
    if (spanDays > 0) sessionsPerWeek = (starts.length / spanDays) * 7
  }

  return {
    totalSessions: starts.length,
    dayOfWeekCounts,
    hourCounts,
    restDayGaps,
    medianRestDays: median(restDayGaps),
    sessionsPerWeek,
    busiestDay: argmax(dayOfWeekCounts),
    busiestHour: argmax(hourCounts),
  }
}
