/**
 * Tests for the push-error classifier (§5.5).
 *
 * Regression guard for a bug where `classify` read a non-existent `.status`
 * field on PostgrestError, so every failure fell through to "transient" — which
 * silently disabled dead-lettering and auth-pause. These pin the mapping to the
 * fields PostgrestError actually has (`code`).
 */

import { describe, expect, it } from 'vitest'
import { classify } from './supabaseBackend'

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

  it('treats a non-auth PostgREST code as permanent', () => {
    expect(classify(err('PGRST100')).status).toBe('permanent') // parse error
    expect(classify(err('PGRST204')).status).toBe('permanent') // no such column
  })

  it('treats a missing/empty code as transient (retry)', () => {
    expect(classify(err('')).status).toBe('transient')
    expect(classify({ name: 'e', message: 'network', details: '', hint: '' } as never).status).toBe(
      'transient',
    )
  })
})
