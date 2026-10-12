import { describe, expect, it } from 'vitest'
import { countRecordBreakingSessions } from '@/data/records'

describe('countRecordBreakingSessions', () => {
  it('does not count the session that first sets a lift’s numbers', () => {
    expect(
      countRecordBreakingSessions([
        { key: 'bench:barbell', at: 1, values: { max_weight: 60, max_reps_any_weight: 8 } },
        { key: 'squat:barbell', at: 1, values: { max_weight: 80 } },
      ]),
    ).toBe(0)
  })

  it('counts each later session that beats one of its records, once', () => {
    expect(
      countRecordBreakingSessions([
        { key: 'bench:barbell', at: 3, values: { max_weight: 70, max_reps_any_weight: 10 } },
        { key: 'bench:barbell', at: 1, values: { max_weight: 60, max_reps_any_weight: 8 } },
        { key: 'bench:barbell', at: 2, values: { max_weight: 60, max_reps_any_weight: 6 } },
        { key: 'bench:barbell', at: 4, values: { max_weight: 65 } },
      ]),
    ).toBe(1)
  })

  it('keeps equipment separate', () => {
    expect(
      countRecordBreakingSessions([
        { key: 'bench:barbell', at: 1, values: { max_weight: 60 } },
        { key: 'bench:dumbbell', at: 2, values: { max_weight: 30 } },
        { key: 'bench:dumbbell', at: 3, values: { max_weight: 32 } },
      ]),
    ).toBe(1)
  })
})
