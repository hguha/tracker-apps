import { describe, expect, it } from 'vitest'
import { heightAnswerCm } from '@/features/onboarding/bodyStep'

describe('heightAnswerCm', () => {
  it('stores a typed height in centimetres', () => {
    expect(heightAnswerCm('70', 'in', null)).toBeCloseTo(177.8, 5)
  })

  it('keeps the saved height when the field is left blank on a replay', () => {
    expect(heightAnswerCm('', 'cm', 180)).toBe(180)
  })
})
