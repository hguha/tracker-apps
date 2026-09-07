import { describe, expect, it } from 'vitest'
import { toPostgresRow } from '../src/supabaseBackend'
import { DEFAULT_TIMESTAMP_COLUMNS } from '../src/columnCase'

describe('toPostgresRow timestamps', () => {
  it('converts the universal columns to ISO', () => {
    const row = toPostgresRow({ updatedAt: 1_785_866_400_000, deletedAt: null })
    expect(row.updated_at).toBe('2026-08-04T18:00:00.000Z')
    expect(row.deleted_at).toBeNull()
  })

  it('leaves an app-specific timestamp as epoch ms when it is not declared', () => {
    // The failure this guards: Postgres rejects the whole push with "date/time field value out
    // of range", so every row dead-letters and the cause is invisible on the client.
    const row = toPostgresRow({ eatenAt: 1_785_866_400_000 })
    expect(row.eaten_at).toBe(1_785_866_400_000)
  })

  it('converts an app-specific timestamp once declared', () => {
    const columns = new Set([...DEFAULT_TIMESTAMP_COLUMNS, 'eaten_at'])
    expect(toPostgresRow({ eatenAt: 1_785_866_400_000 }, columns).eaten_at).toBe(
      '2026-08-04T18:00:00.000Z',
    )
  })

  it('leaves a numeric non-timestamp column alone', () => {
    expect(toPostgresRow({ sortIndex: 1_785_866_400_000 }).sort_index).toBe(1_785_866_400_000)
  })
})
