// Sign-up has three outcomes that look alike on the wire but must not be conflated:
// a session (autoconfirm on), a confirmation email on its way, and an address that
// already has an account — for which Supabase reports success and sends nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// The provider asks the platform whether it's native to pick a redirect URL.
vi.mock('@tracker-engine/platform', () => ({ isNativePlatform: () => false }))

const { SupabaseAuthProvider } = await import('../src/supabaseProvider')

type SignUpResponse = { data: unknown; error: unknown }

function providerWith(signUp: () => Promise<SignUpResponse>) {
  const client = {
    auth: {
      signUp,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  } as unknown as SupabaseClient
  return new SupabaseAuthProvider(client, { nativeRedirectUrl: 'app://auth-callback' })
}

const USER = {
  id: 'u1',
  email: 'new@example.com',
  created_at: '2026-01-01T00:00:00Z',
  user_metadata: {},
}

beforeEach(() => {
  // authRedirectUrl reads window.location on web.
  vi.stubGlobal('window', { location: { origin: 'https://app.test' } })
})

describe('signUpWithPassword', () => {
  it('returns the session when the project auto-confirms', async () => {
    const provider = providerWith(async () => ({
      data: { user: USER, session: { user: USER, access_token: 't' } },
      error: null,
    }))
    const result = await provider.signUpWithPassword('new@example.com', 'longenough')
    expect(result.kind).toBe('session')
  })

  it('returns confirm-sent when a confirmation email is required', async () => {
    const provider = providerWith(async () => ({
      // A genuinely new user comes back with a populated identities array.
      data: { user: { ...USER, identities: [{ id: 'i1' }] }, session: null },
      error: null,
    }))
    const result = await provider.signUpWithPassword('new@example.com', 'longenough')
    expect(result).toEqual({ kind: 'confirm-sent', email: 'new@example.com' })
  })

  it('reports an existing account instead of promising an email that never arrives', async () => {
    const provider = providerWith(async () => ({
      // Supabase's anti-enumeration response: success, no session, no identities.
      data: { user: { ...USER, identities: [] }, session: null },
      error: null,
    }))
    const result = await provider.signUpWithPassword('taken@example.com', 'longenough')
    expect(result.kind).toBe('error')
    expect(result.kind === 'error' && result.message).toMatch(/already has an account/i)
  })

  it('surfaces a real sign-up error', async () => {
    const provider = providerWith(async () => ({
      data: { user: null, session: null },
      error: { message: 'Password is too weak' },
    }))
    const result = await provider.signUpWithPassword('new@example.com', 'x')
    expect(result).toEqual({ kind: 'error', message: 'Password is too weak' })
  })
})
