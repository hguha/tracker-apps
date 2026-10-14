import { describe, expect, it } from 'vitest'
import { dailyWeights } from '../src/daily'

describe('dailyWeights', () => {
  const at = (day: string, hour: number) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00`)
  const reading = (id: string, when: number, kg: number, deletedAt: number | null = null) => ({
    id,
    at: when,
    kg,
    updatedAt: when,
    deletedAt,
  })

  it('keeps one weight a day, the last one entered, oldest day first', () => {
    const rows = dailyWeights(
      [
        reading('c', at('2026-10-02', 7), 79),
        reading('a', at('2026-10-01', 7), 81),
        reading('b', at('2026-10-01', 9), 80.5),
      ],
      'reputation',
    )
    expect(rows.map((row) => [row.day, row.kg, row.id])).toEqual([
      ['2026-10-01', 80.5, 'b'],
      ['2026-10-02', 79, 'c'],
    ])
    expect(rows[0]).toMatchObject({ source: 'reputation', deletedAt: null })
  })

  it('leaves deleted readings out', () => {
    expect(dailyWeights([reading('a', at('2026-10-01', 7), 81, 5)], 'reputation')).toEqual([])
  })
})
