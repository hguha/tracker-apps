import { describe, expect, it } from 'vitest'
import { GAP_BUCKETS, gapTally } from '@/features/insights/chartShared'

describe('gapTally', () => {
  it('counts each gap into exactly one of the gap buckets', () => {
    expect(gapTally([0, 1, 2, 3, 5, 6, 9])).toEqual([2, 1, 1, 2, 1])
    expect(gapTally([])).toHaveLength(GAP_BUCKETS.length)
  })
})
