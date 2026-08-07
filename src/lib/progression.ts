/**
 * Deterministic progression (§7 Phase 4).
 *
 * The rules version of programming automation — no LLM. Given how the last
 * session against a template-exercise went, decide the next session's target
 * weight and rep target. Pure and total: same inputs, same output, no I/O.
 *
 * The scheme is **double progression**: keep the weight until every working set
 * reaches the top of the rep range (optionally gated on RPE), then add an
 * increment and drop back to the bottom of the range. It intentionally does
 * nothing when the data doesn't support a confident step — a missing weight, a
 * short session, or reps still below the top just holds.
 */

import type { ProgressionRule } from '@/domain/types'

/** What a single logged set contributes to the decision. */
export interface ProgressionSet {
  weightKg: number | null
  reps: number | null
  rpe: number | null
}

export interface ProgressionInput {
  rule: ProgressionRule
  /** The template's current targets. */
  targetWeightKg: number | null
  targetRepsLow: number | null
  targetRepsHigh: number | null
  /** The working sets from the most recent session against this exercise, if any. */
  lastSets: ProgressionSet[]
}

export interface ProgressionResult {
  /** The weight to seed next session, or null to leave it to history. */
  targetWeightKg: number | null
  /** The rep target to seed (bottom of range after an advance). */
  targetReps: number | null
  /** True when the increment was applied — lets the UI say "progressed +2.5". */
  advanced: boolean
}

/**
 * Decide the next target. Advances only when *every* working set hit the top of
 * the range and the hardest set was within the RPE cap; otherwise holds the
 * current weight so the lifter gets another crack at clearing the range.
 */
export function nextTarget(input: ProgressionInput): ProgressionResult {
  const { rule, targetWeightKg, targetRepsLow, targetRepsHigh, lastSets } = input
  const bottom = targetRepsLow ?? targetRepsHigh
  const hold: ProgressionResult = {
    targetWeightKg,
    targetReps: bottom,
    advanced: false,
  }

  // No history, no range top, or no weight to step from → nothing to decide on.
  if (targetRepsHigh === null || targetWeightKg === null) return hold
  const performed = lastSets.filter((s) => s.reps !== null)
  if (performed.length === 0) return hold

  // Advance only if the last session was actually *at* this weight — if the
  // lifter went heavier or lighter than the template, the template's own number
  // isn't the baseline to progress from, so hold and let them re-anchor.
  const atTargetWeight = performed.every(
    (s) => s.weightKg !== null && Math.abs(s.weightKg - targetWeightKg) < 0.01,
  )
  if (!atTargetWeight) return hold

  const everySetHitTop = performed.every((s) => (s.reps ?? 0) >= targetRepsHigh)
  if (!everySetHitTop) return hold

  // RPE gate: the hardest (max-RPE) set must be within the cap. Missing RPE is
  // treated as "within cap", since RPE is optional in this app (§6.4).
  if (rule.maxRpe !== null) {
    const rpes = performed.map((s) => s.rpe).filter((r): r is number => r !== null)
    const hardest = rpes.length > 0 ? Math.max(...rpes) : null
    if (hardest !== null && hardest > rule.maxRpe) return hold
  }

  return {
    targetWeightKg: round(targetWeightKg + rule.incrementKg),
    targetReps: bottom,
    advanced: true,
  }
}

/** Trim float dust from the added increment (0.1 g precision is plenty). */
function round(kg: number): number {
  return Math.round(kg * 1000) / 1000
}
