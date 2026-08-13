/**
 * Tests for the push-error classifier (§5.5).
 *
 * Regression guard for a bug where `classify` read a non-existent `.status`
 * field on PostgrestError, so every failure fell through to "transient" — which
 * silently disabled dead-lettering and auth-pause. These pin the mapping to the
 * fields PostgrestError actually has (`code`).
 */

import { describe, expect, it } from 'vitest'
import { classify, toPostgresRow } from '@/sync/supabaseBackend'

/** Minimal PostgrestError-shaped object for the classifier. */
function err(code: string, message = 'x') {
  return { name: 'PostgrestError', message, details: '', hint: '', code } as never
}

describe('classify', () => {
  it('treats a JWT/auth code as auth (pause, never dead-letter)', () => {
    expect(classify(err('PGRST301')).status).toBe('auth')
    expect(classify(err('PGRST302')).status).toBe('auth')
    expect(classify(err('28000')).status).toBe('auth') // invalid authorization
  })

  it('treats an RLS or constraint SQLSTATE as permanent (dead-letter)', () => {
    expect(classify(err('42501')).status).toBe('permanent') // RLS violation
    expect(classify(err('23505')).status).toBe('permanent') // unique violation
    expect(classify(err('23514')).status).toBe('permanent') // check violation
    expect(classify(err('23502')).status).toBe('permanent') // not-null violation
  })

  it('treats a foreign-key violation as transient, since the parent may still be queued', () => {
    // A set whose workout_exercise hasn't been pushed yet is an ordering problem,
    // not a rejection: the drain halts on transient and resumes in seq order,
    // which delivers the parent first. Dead-lettering it strands the child.
    expect(classify(err('23503')).status).toBe('transient')
  })

  it('treats a non-auth PostgREST code as permanent', () => {
    expect(classify(err('PGRST100')).status).toBe('permanent') // parse error
    expect(classify(err('PGRST204')).status).toBe('permanent') // no such column
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
    // A field with no column dead-letters the whole row permanently, so the
    // payload must be exactly the table's columns.
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
    const row = toPostgresRow({
      id: 'w1',
      userId: 'u1',
      startedAt: at,
      endedAt: null,
      deletedAt: null,
    })
    expect(row.user_id).toBe('u1')
    expect(row.started_at).toBe(new Date(at).toISOString())
    // A null timestamp stays null rather than becoming an epoch string.
    expect(row.ended_at).toBeNull()
  })
})
