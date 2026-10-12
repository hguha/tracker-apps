import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@tracker-engine/platform', () => ({ isNativePlatform: () => false }))

const { completeSessionFromUrl } = await import('../src/deepLinks')

const CALLBACK = 'macros://auth-callback'

function client(error: { message: string } | null = null) {
  const exchangeCodeForSession = vi.fn(async () => ({ error }))
  const setSession = vi.fn(async () => ({ error: null }))
  return {
    client: { auth: { exchangeCodeForSession, setSession } } as unknown as SupabaseClient,
    exchangeCodeForSession,
    setSession,
  }
}

describe('completeSessionFromUrl', () => {
  it('exchanges the code from this app’s own callback', async () => {
    const { client: c, exchangeCodeForSession } = client()
    expect(await completeSessionFromUrl(c, `${CALLBACK}?code=abc`, CALLBACK)).toBe(true)
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc', undefined)
  })

  it('passes the flow id so the matching verifier is used', async () => {
    const { client: c, exchangeCodeForSession } = client()
    await completeSessionFromUrl(c, `${CALLBACK}?code=abc&sb_flow_id=f1`, CALLBACK)
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc', { flowId: 'f1' })
  })

  it('never signs in from tokens carried in the link', async () => {
    const { client: c, setSession, exchangeCodeForSession } = client()
    const url = `${CALLBACK}#access_token=attacker&refresh_token=attacker`
    expect(await completeSessionFromUrl(c, url, CALLBACK)).toBe(false)
    expect(setSession).not.toHaveBeenCalled()
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('ignores links to any other address', async () => {
    const { client: c, exchangeCodeForSession } = client()
    expect(await completeSessionFromUrl(c, 'macros://elsewhere?code=abc', CALLBACK)).toBe(false)
    expect(await completeSessionFromUrl(c, 'other://auth-callback?code=abc', CALLBACK)).toBe(false)
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('ignores the callback without a code', async () => {
    const { client: c, exchangeCodeForSession } = client()
    expect(await completeSessionFromUrl(c, CALLBACK, CALLBACK)).toBe(false)
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('reports a rejected code instead of throwing', async () => {
    const { client: c } = client({ message: 'expired' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await completeSessionFromUrl(c, `${CALLBACK}?code=old`, CALLBACK)).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})
