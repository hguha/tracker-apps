import { describe, expect, it } from 'vitest'
import type { MovementPattern, Region } from '@/domain/types'
import { inferSplit, partOfDay, sessionTitle, type SetSignal } from './sessionTitle'

function signals(
  entries: [Region, MovementPattern, number][],
): SetSignal[] {
  return entries.flatMap(([region, pattern, count]) =>
    Array.from({ length: count }, () => ({ region, pattern })),
  )
}

/** A timestamp at a known local hour, so part-of-day is deterministic. */
function atHour(hour: number): number {
  const d = new Date(2026, 6, 29, hour, 0, 0)
  return d.getTime()
}

describe('partOfDay', () => {
  it('splits at noon and 5pm', () => {
    expect(partOfDay(atHour(6))).toBe('Morning')
    expect(partOfDay(atHour(11))).toBe('Morning')
    expect(partOfDay(atHour(12))).toBe('Afternoon')
    expect(partOfDay(atHour(16))).toBe('Afternoon')
    expect(partOfDay(atHour(17))).toBe('Evening')
    expect(partOfDay(atHour(22))).toBe('Evening')
  })
})

describe('inferSplit', () => {
  it('names a single dominant region', () => {
    expect(inferSplit(signals([['legs', 'squat', 9]]))).toBe('Legs')
    expect(inferSplit(signals([['back', 'horizontal_pull', 8]]))).toBe('Back')
  })

  it('recognizes a push session', () => {
    const push = signals([
      ['chest', 'horizontal_push', 6],
      ['shoulders', 'vertical_push', 3],
      ['triceps', 'isolation', 3],
    ])
    expect(inferSplit(push)).toBe('Push')
  })

  it('recognizes a pull session', () => {
    const pull = signals([
      ['back', 'vertical_pull', 6],
      ['back', 'horizontal_pull', 3],
      ['biceps', 'isolation', 3],
    ])
    expect(inferSplit(pull)).toBe('Pull')
  })

  it('distinguishes push from pull when both share arm accessories', () => {
    // Same movement story, opposite patterns — triceps ride with pressing,
    // biceps with rowing.
    const mostlyPressing = signals([
      ['chest', 'horizontal_push', 8],
      ['triceps', 'isolation', 2],
    ])
    const mostlyRowing = signals([
      ['back', 'horizontal_pull', 8],
      ['biceps', 'isolation', 2],
    ])
    expect(inferSplit(mostlyPressing)).toBe('Push')
    expect(inferSplit(mostlyRowing)).toBe('Pull')
  })

  it('calls a mixed upper-body session Upper', () => {
    const upper = signals([
      ['chest', 'horizontal_push', 4],
      ['back', 'horizontal_pull', 4],
      ['shoulders', 'vertical_push', 2],
    ])
    expect(inferSplit(upper)).toBe('Upper')
  })

  it('calls a spread-out session Full Body', () => {
    const full = signals([
      ['chest', 'horizontal_push', 3],
      ['legs', 'squat', 3],
      ['back', 'horizontal_pull', 3],
    ])
    expect(inferSplit(full)).toBe('Full Body')
  })

  it('labels a cardio-only session Cardio', () => {
    expect(inferSplit(signals([['cardio', 'cardio', 3]]))).toBe('Cardio')
  })

  it('returns null with nothing logged', () => {
    expect(inferSplit([])).toBeNull()
  })

  it('returns null for two unrelated regions with no clear story', () => {
    const ambiguous = signals([
      ['legs', 'squat', 3],
      ['core', 'isolation', 3],
    ])
    expect(inferSplit(ambiguous)).toBeNull()
  })
})

describe('sessionTitle', () => {
  it('prefers a user-supplied title', () => {
    const title = sessionTitle('Pull A', atHour(18), signals([['legs', 'squat', 5]]))
    expect(title).toBe('Pull A')
  })

  it('ignores a whitespace-only title', () => {
    const title = sessionTitle('   ', atHour(18), signals([['legs', 'squat', 5]]))
    expect(title).toBe('Jul 29 Evening · Legs')
  })

  it('derives date, time of day, and split', () => {
    const title = sessionTitle(
      '',
      atHour(19),
      signals([
        ['chest', 'horizontal_push', 6],
        ['triceps', 'isolation', 3],
      ]),
    )
    expect(title).toBe('Jul 29 Evening · Push')
  })

  it('omits the split when nothing is logged', () => {
    expect(sessionTitle('', atHour(8), [])).toBe('Jul 29 Morning')
  })
})
