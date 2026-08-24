// Double-progression (§7 Phase 4), no LLM: hold the weight until every working
// set hits the top of the rep range (optionally under an RPE cap), then add the
// increment and drop to the bottom. Pure and total; holds whenever the data
// doesn't support a confident step.

import type { ProgressionRule } from '@/domain/types'

export interface ProgressionSet {
  weightKg: number | null
  reps: number | null
  rpe: number | null
}

export interface ProgressionInput {
  rule: ProgressionRule
  targetWeightKg: number | null
  targetRepsLow: number | null
  targetRepsHigh: number | null
  lastSets: ProgressionSet[]
}

export interface ProgressionResult {
  targetWeightKg: number | null
  targetReps: number | null
  advanced: boolean
}

export function nextTarget(input: ProgressionInput): ProgressionResult {
  const { rule, targetWeightKg, targetRepsLow, targetRepsHigh, lastSets } = input
  const bottom = targetRepsLow ?? targetRepsHigh
  const hold: ProgressionResult = {
    targetWeightKg,
    targetReps: bottom,
    advanced: false,
  }

  if (targetRepsHigh === null || targetWeightKg === null) return hold
  const performed = lastSets.filter((s) => s.reps !== null)
  if (performed.length === 0) return hold

  // Only progress from the template's own weight; if the lifter went off it last
  // session, hold and let them re-anchor.
  const atTargetWeight = performed.every(
    (s) => s.weightKg !== null && Math.abs(s.weightKg - targetWeightKg) < 0.01,
  )
  if (!atTargetWeight) return hold

  const everySetHitTop = performed.every((s) => (s.reps ?? 0) >= targetRepsHigh)
  if (!everySetHitTop) return hold

  // Missing RPE counts as within-cap, since RPE is optional (§6.4).
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

function round(kg: number): number {
  return Math.round(kg * 1000) / 1000
}
