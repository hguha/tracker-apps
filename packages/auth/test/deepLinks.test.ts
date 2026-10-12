import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@tracker-engine/platform', () => ({ isNativePlatform: () => false }))

const { completeSessionFromUrl } = await import('../src/deepLinks')

function client(error: { message: string } | null = null) {
  const setSession = vi.fn(async () => ({ error }))
  return { client: { auth: { setSession } } as unknown as SupabaseClient, setSession }
}

describe('completeSessionFromUrl', () => {
  it('signs in from the tokens in a callback fragment', async () => {
    const { client: c, setSession } = client()
    const ok = await completeSessionFromUrl(
      c,
      'macros://auth-callback#access_token=a&refresh_token=r&type=signup',
    )
    expect(ok).toBe(true)
    expect(setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' })
  })

  it('ignores a URL without tokens', async () => {
    const { client: c, setSession } = client()
    expect(await completeSessionFromUrl(c, 'macros://auth-callback')).toBe(false)
    expect(setSession).not.toHaveBeenCalled()
  })

  it('reports a rejected link instead of throwing', async () => {
    const { client: c } = client({ message: 'expired' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await completeSessionFromUrl(c, 'x://y#access_token=a&refresh_token=r')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})
