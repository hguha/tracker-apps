/**
 * Push-error classifier. Regression guard for a bug where `classify` read a
 * non-existent `.status` field on PostgrestError, so every failure fell through to
 * "transient" — silently disabling dead-lettering and auth-pause. These pin the
 * mapping to the field PostgrestError actually has (`code`).
 */

import { describe, expect, it } from 'vitest'
import { classify, toPostgresRow } from '../src/supabaseBackend'

/** Minimal PostgrestError-shaped object for the classifier. */
function err(code: string, message = 'x') {
  return { name: 'PostgrestError', message, details: '', hint: '', code } as never
}

describe('classify', () => {
  it('treats a JWT/auth code as auth (pause, never dead-letter)', () => {
    expect(classify(err('PGRST301')).status).toBe('auth')
    expect(classify(err('PGRST302')).status).toBe('auth')
    expect(classify(err('28000')).status).toBe('auth')
  })

  it('treats an RLS or constraint SQLSTATE as permanent (dead-letter)', () => {
    expect(classify(err('42501')).status).toBe('permanent')
    expect(classify(err('23505')).status).toBe('permanent')
    expect(classify(err('23514')).status).toBe('permanent')
    expect(classify(err('23502')).status).toBe('permanent')
  })

  it('treats a foreign-key violation as transient, since the parent may still be queued', () => {
    expect(classify(err('23503')).status).toBe('transient')
  })

  it('treats a non-auth PostgREST code as permanent', () => {
    expect(classify(err('PGRST100')).status).toBe('permanent')
    expect(classify(err('PGRST204')).status).toBe('permanent')
  })

  it('treats a missing/empty code as transient (retry)', () => {
    expect(classify(err('')).status).toBe('transient')
    expect(
      classify({ name: 'e', message: 'network', details: '', hint: '' } as never).status,
    ).toBe('transient')
  })
})

describe('toPostgresRow', () => {
  it('maps every camelCase field to its snake_case column', () => {
    const row = toPostgresRow({
      id: 'my_lift',
      name: 'My Lift',
      region: 'chest',
      bodyweightFactor: null,
      aliases: ['ml'],
    })
    expect(row.region).toBe('chest')
    expect(row.bodyweight_factor).toBeNull()
    expect(row.aliases).toEqual(['ml'])
  })

  it('converts timestamps to ISO', () => {
    const at = Date.UTC(2026, 0, 2, 3, 4, 5)
    const row = toPostgresRow({ id: 'w1', userId: 'u1', startedAt: at, endedAt: null, deletedAt: null })
    expect(row.user_id).toBe('u1')
    expect(row.started_at).toBe(new Date(at).toISOString())
    expect(row.ended_at).toBeNull()
  })
})
