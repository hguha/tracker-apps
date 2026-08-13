/**
 * Placeholder (ghost-value) resolution for a session's set rows (§6.2, §7.2).
 *
 * Precedence per row, highest first:
 *   1. A per-set override from a repeated workout or a template.
 *   2. The matching set (by index) from the last time this exercise was trained.
 *   3. Carry-forward: the most recent numbers from earlier in this same card.
 * Blank only when the exercise has never been done and nothing precedes the row.
 */

import type { PerformedSet } from '@/domain/types'

export interface SetValues {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
}

export function hasValue(v: SetValues): boolean {
  return (
    v.weightKg !== null ||
    v.reps !== null ||
    v.durationSeconds !== null ||
    v.distanceM !== null
  )
}

function pick(v: SetValues): PerformedSet {
  return {
    weightKg: v.weightKg,
    reps: v.reps,
    durationSeconds: v.durationSeconds,
    distanceM: v.distanceM,
  }
}

export function resolvePlaceholders(
  sets: (SetValues & { id: string })[],
  overridesById: Record<string, SetValues>,
  previousByIndex: (SetValues | undefined)[],
): (PerformedSet | undefined)[] {
  const resolved: (PerformedSet | undefined)[] = []
  let carry: PerformedSet | undefined

  sets.forEach((set, index) => {
    const override = overridesById[set.id]
    const previous = previousByIndex[index]
    const candidate: PerformedSet | undefined = override
      ? pick(override)
      : previous
        ? pick(previous)
        : carry

    resolved.push(candidate)

    // What the user actually logged in this row wins over its placeholder when
    // feeding the next row's carry.
    if (hasValue(set)) carry = pick(set)
    else if (candidate && hasValue(candidate)) carry = candidate
  })

  return resolved
}
