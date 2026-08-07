/**
 * Placeholder (ghost-value) resolution for a session's set rows (§6.2, §7.2).
 *
 * Pure and standalone so the precedence rules are unit-testable without a
 * rendered card — this logic is subtle and has regressed before.
 *
 * Precedence per row, highest first:
 *   1. A per-set override from a repeated workout or a template — an explicit
 *      request for *that* source's numbers.
 *   2. The matching set (by index) from the last time this exercise was trained.
 *   3. Carry-forward: the most recent numbers from earlier in this same card —
 *      either what was actually logged in an earlier row, or that row's own
 *      placeholder. So on a brand-new exercise, filling set 1 gives set 2 a
 *      placeholder even with no history at all.
 * Blank only when the exercise has never been done and nothing precedes the row.
 */

import type { PerformedSet } from '@/domain/types'

/** The numeric fields a placeholder or a logged set carries. */
export interface SetValues {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
}

/** Whether a set/placeholder carries anything worth showing as a ghost value. */
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

/**
 * Resolve the placeholder for each current set row, in order.
 *
 * @param sets            this session's rows (their own logged values feed carry-forward)
 * @param overridesById   per-set overrides from a repeat/template, keyed by set id
 * @param previousByIndex last session's sets, aligned to `sets` by index
 */
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

    // Update the carry for the *next* row. What the user actually logged in this
    // row wins over its placeholder — set 2 should suggest what set 1 was filled
    // with, not what set 1 was merely hinting.
    if (hasValue(set)) carry = pick(set)
    else if (candidate && hasValue(candidate)) carry = candidate
  })

  return resolved
}
