// Deep-link auth completion for the native shell.
//
// The magic link lands on a URL carrying the session tokens in its fragment
// (implicit flow). Two ways that URL reaches a native app:
//   - custom scheme `fitnote://auth-callback#...` — survives Supabase's 302 from
//     /auth/v1/verify, so this is what the email redirect targets (below).
//   - a Universal Link tap on https://hirshguha.com/workout-tracker/#... — opens
//     the app directly (not via redirect), handled the same way.
// Either arrives through Capacitor's appUrlOpen (warm) or getLaunchUrl (cold).
//
// The OTP code path stays the primary, no-deep-link sign-in; this is the polish
// that lets the link itself open the app.
import { isNativePlatform } from '@/lib/platform'
import { getSupabase } from '@/backend/supabaseClient'

async function completeFromUrl(url: string): Promise<void> {
  const client = getSupabase()
  if (!client) return
  const fragment = url.includes('#') ? url.slice(url.indexOf('#') + 1) : ''
  if (!fragment) return
  const params = new URLSearchParams(fragment)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return
  try {
    await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
  } catch {
    // A stale or malformed link — the code field is still there to fall back on.
  }
}

export function initDeepLinks(): void {
  if (!isNativePlatform()) return
  void (async () => {
    const { App } = await import('@capacitor/app')
    await App.addListener('appUrlOpen', ({ url }) => void completeFromUrl(url))
    // Cold start: the launch URL isn't delivered through the listener.
    const launch = await App.getLaunchUrl()
    if (launch?.url) void completeFromUrl(launch.url)
  })()
}
