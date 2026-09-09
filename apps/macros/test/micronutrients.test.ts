import { describe, expect, it } from 'vitest'
import {
  NUTRIENT_TARGETS,
  bmi,
  dietQuality,
  goalWeightKg,
  nutrientStatus,
  nutrientTargets,
} from '@/lib/micronutrients'
import { EMPTY_NUTRIENTS, type Nutrients } from '@/domain/types'

function nutrients(over: Partial<Nutrients>): Nutrients {
  return { ...EMPTY_NUTRIENTS, ...over }
}

describe('nutrientStatus', () => {
  it('calls an unrecorded nutrient unknown, not zero', () => {
    // The important case: an Open Food Facts row often has macros and nothing else. Treating
    // that as "you ate no fibre" would punish the user for the database's gaps.
    const fibre = nutrientStatus(nutrients({ fiberMg: null })).find((s) => s.key === 'fiberMg')
    expect(fibre?.verdict).toBe('unknown')
    expect(fibre?.ratio).toBeNull()
  })

  it('flags a floor that is clearly short', () => {
    const fibre = nutrientStatus(nutrients({ fiberMg: 5_000 })).find((s) => s.key === 'fiberMg')
    expect(fibre?.verdict).toBe('short')
  })

  it('accepts a floor that is close enough', () => {
    const fibre = nutrientStatus(nutrients({ fiberMg: 24_000 })).find((s) => s.key === 'fiberMg')
    expect(fibre?.verdict).toBe('ok')
  })

  it('treats a ceiling the other way round', () => {
    const low = nutrientStatus(nutrients({ sodiumMg: 800 })).find((s) => s.key === 'sodiumMg')
    const high = nutrientStatus(nutrients({ sodiumMg: 4_000 })).find((s) => s.key === 'sodiumMg')
    expect(low?.verdict).toBe('ok')
    expect(high?.verdict).toBe('over')
  })
})

describe('dietQuality', () => {
  it('says it cannot judge when nothing was recorded', () => {
    const quality = dietQuality(EMPTY_NUTRIENTS)
    expect(quality.measured).toBe(0)
    expect(quality.summary).toMatch(/No nutrient data/)
  })

  it('reports how much of the picture it could see, and never invents a score', () => {
    // One nutrient recorded and in range. The old code reduced this to "100%", which read as a
    // verdict on the whole diet from a single data point.
    const quality = dietQuality(nutrients({ fiberMg: 30_000 }))
    expect(quality).not.toHaveProperty('score')
    expect(quality.measured).toBe(1)
    expect(quality.tracked).toBe(7)
    expect(quality.summary).toMatch(/1 of 7 recorded/)
  })

  it('names each nutrient out of range rather than averaging them away', () => {
    const quality = dietQuality(nutrients({ fiberMg: 2_000, sodiumMg: 500 }))
    expect(quality.short.map((s) => s.key)).toEqual(['fiberMg'])
    expect(quality.onTarget.map((s) => s.key)).toEqual(['sodiumMg'])
  })

  it('names what is low and what is high, in one sentence', () => {
    const quality = dietQuality(nutrients({ fiberMg: 2_000, sodiumMg: 5_000 }))
    expect(quality.summary).toMatch(/Low on fibre/)
    expect(quality.summary).toMatch(/high on sodium/)
  })

  it('says everything is fine when it is', () => {
    const quality = dietQuality(
      nutrients({ fiberMg: 30_000, potassiumMg: 5_000, sodiumMg: 1_500 }),
    )
    expect(quality.short).toEqual([])
    expect(quality.over).toEqual([])
    expect(quality.summary).toMatch(/in range/)
  })
})

describe('goalWeightKg', () => {
  it('projects a deficit downward', () => {
    expect(goalWeightKg(80, -0.5, 12)!).toBeLessThan(80)
  })

  it('projects a surplus upward', () => {
    expect(goalWeightKg(80, 0.25, 12)!).toBeGreaterThan(80)
  })

  it('has nothing to project when maintaining', () => {
    expect(goalWeightKg(80, 0)).toBeNull()
  })
})

describe('bmi', () => {
  it('computes from kg and cm', () => {
    expect(bmi(80, 180)).toBeCloseTo(24.7, 1)
  })
})

describe('sex-adjusted references', () => {
  it('uses 8 mg of iron for a man and 18 for a woman', () => {
    // The 18 mg label Daily Value is set for menstruating women. Applied to a man it flagged him
    // short of iron nearly every day — a warning that is wrong and teaches people to ignore the
    // whole panel.
    const male = nutrientStatus(nutrients({ ironMg: 10 }), 'male').find((s) => s.key === 'ironMg')
    const female = nutrientStatus(nutrients({ ironMg: 10 }), 'female').find(
      (s) => s.key === 'ironMg',
    )
    expect(male?.verdict).toBe('ok')
    expect(female?.verdict).toBe('short')
  })

  it('keeps ceilings the same for both', () => {
    for (const sex of ['male', 'female'] as const) {
      const sodium = nutrientTargets(sex).find((target) => target.key === 'sodiumMg')
      expect(sodium?.reference).toBe(2_300)
    }
  })

  it('falls back to a neutral set with no sex on file', () => {
    expect(nutrientTargets(null).map((t) => t.key)).toEqual(NUTRIENT_TARGETS.map((t) => t.key))
  })
})
