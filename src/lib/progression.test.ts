import { describe, expect, it } from 'vitest'
import { nextTarget, type ProgressionInput, type ProgressionSet } from './progression'
import type { ProgressionRule } from '@/domain/types'

const RULE: ProgressionRule = { kind: 'double', incrementKg: 2.5, maxRpe: 8 }

function input(partial: Partial<ProgressionInput> = {}): ProgressionInput {
  return {
    rule: RULE,
    targetWeightKg: 100,
    targetRepsLow: 8,
    targetRepsHigh: 10,
    lastSets: [],
    ...partial,
  }
}

function set(reps: number, rpe: number | null = null, weightKg = 100): ProgressionSet {
  return { weightKg, reps, rpe }
}

describe('nextTarget — double progression', () => {
  it('advances when every set hit the top of the range within RPE', () => {
    const r = nextTarget(input({ lastSets: [set(10, 8), set(10, 7), set(10, 8)] }))
    expect(r.advanced).toBe(true)
    expect(r.targetWeightKg).toBe(102.5)
    // Resets to the bottom of the range after adding weight.
    expect(r.targetReps).toBe(8)
  })

  it('holds when a set fell short of the top', () => {
    const r = nextTarget(input({ lastSets: [set(10), set(10), set(9)] }))
    expect(r.advanced).toBe(false)
    expect(r.targetWeightKg).toBe(100)
  })

  it('holds when the hardest set exceeded the RPE cap', () => {
    const r = nextTarget(input({ lastSets: [set(10, 9), set(10, 8)] }))
    expect(r.advanced).toBe(false)
    expect(r.targetWeightKg).toBe(100)
  })

  it('ignores RPE when the rule has no cap', () => {
    const noCap: ProgressionRule = { kind: 'double', incrementKg: 5, maxRpe: null }
    const r = nextTarget(input({ rule: noCap, lastSets: [set(10, 10), set(10, 10)] }))
    expect(r.advanced).toBe(true)
    expect(r.targetWeightKg).toBe(105)
  })

  it('treats missing RPE as within the cap (RPE is optional)', () => {
    const r = nextTarget(input({ lastSets: [set(10, null), set(10, null)] }))
    expect(r.advanced).toBe(true)
  })

  it('holds when the last session used a different weight than the template', () => {
    // Lifter went heavier than the plan — the template weight isn't the baseline.
    const r = nextTarget(input({ lastSets: [set(10, 7, 105), set(10, 7, 105)] }))
    expect(r.advanced).toBe(false)
    expect(r.targetWeightKg).toBe(100)
  })

  it('holds with no history to judge', () => {
    const r = nextTarget(input({ lastSets: [] }))
    expect(r.advanced).toBe(false)
    expect(r.targetWeightKg).toBe(100)
    expect(r.targetReps).toBe(8)
  })

  it('holds when the template has no weight to step from', () => {
    const r = nextTarget(input({ targetWeightKg: null, lastSets: [set(10, 8)] }))
    expect(r.advanced).toBe(false)
    expect(r.targetWeightKg).toBeNull()
  })

  it('holds when there is no rep-range top', () => {
    const r = nextTarget(
      input({ targetRepsHigh: null, targetRepsLow: 5, lastSets: [set(8, 6)] }),
    )
    expect(r.advanced).toBe(false)
  })

  it('keeps the increment clean (no float dust)', () => {
    const micro: ProgressionRule = { kind: 'double', incrementKg: 1.25, maxRpe: 8 }
    const r = nextTarget(
      input({ rule: micro, targetWeightKg: 60, lastSets: [set(10, 7, 60)] }),
    )
    expect(r.targetWeightKg).toBe(61.25)
  })
})
