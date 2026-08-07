import { describe, expect, it } from 'vitest'
import {
  conditionLabel,
  evaluateAvatar,
  fitnessLevel,
  overallCondition,
  regionFitness,
  WINDOW_DAYS,
} from './avatar'
import type { Region } from '@/domain/types'

describe('regionFitness', () => {
  it('is zero for a region never trained', () => {
    expect(regionFitness({ setsInWindow: 0, daysSinceTrained: null })).toBe(0)
  })

  it('peaks when well-trained and fresh', () => {
    expect(regionFitness({ setsInWindow: 12, daysSinceTrained: 0 })).toBe(1)
  })

  it('decays visibly with days of neglect (classic tamagotchi)', () => {
    const fresh = regionFitness({ setsInWindow: 12, daysSinceTrained: 0 })
    const week = regionFitness({ setsInWindow: 12, daysSinceTrained: 7 })
    expect(week).toBeLessThan(fresh)
    // A week out, the same work should have shrunk to roughly a third.
    expect(week).toBeLessThan(0.4)
  })

  it('flatlines once neglect passes the decay horizon', () => {
    expect(regionFitness({ setsInWindow: 12, daysSinceTrained: 30 })).toBe(0)
  })

  it('scales with how much work is in the window', () => {
    const light = regionFitness({ setsInWindow: 3, daysSinceTrained: 0 })
    const heavy = regionFitness({ setsInWindow: 12, daysSinceTrained: 0 })
    expect(light).toBeLessThan(heavy)
    expect(light).toBeGreaterThan(0)
  })
})

describe('fitnessLevel', () => {
  it('maps the score range onto four discrete states', () => {
    expect(fitnessLevel(0)).toBe(0)
    expect(fitnessLevel(0.2)).toBe(1)
    expect(fitnessLevel(0.6)).toBe(2)
    expect(fitnessLevel(1)).toBe(3)
  })
})

describe('evaluateAvatar', () => {
  it('returns an entry for every region, defaulting the untrained to zero', () => {
    const result = evaluateAvatar(new Map())
    // 7 muscle regions + cardio.
    expect(result).toHaveLength(8)
    expect(result.every((r) => r.fitness === 0 && r.level === 0)).toBe(true)
    expect(result.some((r) => r.region === 'cardio')).toBe(true)
  })

  it('reflects the inputs it is given', () => {
    const inputs = new Map<
      Region,
      { setsInWindow: number; daysSinceTrained: number | null }
    >([
      ['legs', { setsInWindow: 12, daysSinceTrained: 0 }],
      ['chest', { setsInWindow: 0, daysSinceTrained: null }],
    ])
    const result = evaluateAvatar(inputs)
    expect(result.find((r) => r.region === 'legs')!.level).toBe(3)
    expect(result.find((r) => r.region === 'chest')!.level).toBe(0)
  })
})

describe('overallCondition', () => {
  it('excludes cardio — it is the aura, not the body', () => {
    // Only cardio is high; the muscle body is untrained, so overall stays 0.
    const result = evaluateAvatar(
      new Map<Region, { setsInWindow: number; daysSinceTrained: number | null }>([
        ['cardio', { setsInWindow: 12, daysSinceTrained: 0 }],
      ]),
    )
    expect(overallCondition(result)).toBe(0)
  })

  it('labels the overall condition without nagging', () => {
    expect(conditionLabel(0)).toBe('Out of shape')
    expect(conditionLabel(1)).toBe('Peak shape')
  })
})

describe('window constant', () => {
  it('looks back a fortnight', () => {
    expect(WINDOW_DAYS).toBe(14)
  })
})
