import { describe, expect, it } from 'vitest'
import { bmi, dietQuality, goalWeightKg, nutrientStatus } from '@/lib/micronutrients'
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
    expect(quality.score).toBeNull()
    expect(quality.summary).toMatch(/Not enough nutrient data/)
  })

  it('scores over what was measurable, not over everything', () => {
    // One nutrient recorded and in range: 100% of what could be judged, with the rest reported
    // as unknown so a two-data-point score can't pose as a clean bill of health.
    const quality = dietQuality(nutrients({ fiberMg: 30_000 }))
    expect(quality.score).toBe(100)
    expect(quality.unknownCount).toBe(6)
  })

  it('drops the score for each nutrient out of range', () => {
    const quality = dietQuality(nutrients({ fiberMg: 2_000, sodiumMg: 500 }))
    expect(quality.score).toBe(50)
    expect(quality.short.map((s) => s.key)).toEqual(['fiberMg'])
  })

  it('names what is low and what is high, in one sentence', () => {
    const quality = dietQuality(nutrients({ fiberMg: 2_000, sodiumMg: 5_000 }))
    expect(quality.summary).toMatch(/low on fibre/)
    expect(quality.summary).toMatch(/high on sodium/)
  })

  it('says everything is fine when it is', () => {
    const quality = dietQuality(
      nutrients({ fiberMg: 30_000, potassiumMg: 5_000, sodiumMg: 1_500 }),
    )
    expect(quality.score).toBe(100)
    expect(quality.summary).toMatch(/good range/)
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
