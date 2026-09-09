import { describe, expect, it } from 'vitest'
import { portionLabel } from '@/features/shared/format'

describe('portionLabel', () => {
  it('shows the weight instead of a bare FNDDS portion code', () => {
    // "10205" and "61700" were being offered as the portion choices for lasagna.
    expect(portionLabel({ label: '10205', grams: 218 })).toBe('218 g')
    expect(portionLabel({ label: '1', grams: 55.5 })).toBe('56 g')
  })

  it('leaves a real label alone', () => {
    expect(portionLabel({ label: '1 cup', grams: 218 })).toBe('1 cup')
    expect(portionLabel({ label: '1 piece (1/6 of 8" square)', grams: 218 })).toBe(
      '1 piece (1/6 of 8" square)',
    )
  })
})
