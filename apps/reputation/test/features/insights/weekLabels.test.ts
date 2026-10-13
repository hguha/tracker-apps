import { describe, expect, it } from 'vitest'
import { weekLabels } from '@/features/insights/chartShared'

describe('weekLabels', () => {
  it('labels a week by its own local start day, not the day before', () => {
    expect(weekLabels(['2026-10-05', '2026-10-12'])).toEqual(['Oct 5', 'Oct 12'])
  })
})
