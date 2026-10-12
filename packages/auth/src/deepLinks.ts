import type { SupabaseClient } from '@supabase/supabase-js'
import { isNativePlatform } from '@tracker-engine/platform'

export async function completeSessionFromUrl(
  client: SupabaseClient | null,
  url: string,
): Promise<boolean> {
  if (!client) return false
  const fragment = url.includes('#') ? url.slice(url.indexOf('#') + 1) : ''
  const params = new URLSearchParams(fragment)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return false
  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (error) {
    console.warn('[auth] sign-in link could not be used', error.message)
    return false
  }
  return true
}

export function installAuthDeepLinks(getClient: () => SupabaseClient | null): void {
  if (!isNativePlatform()) return
  const complete = (url: string) =>
    void completeSessionFromUrl(getClient(), url).catch((error) =>
      console.warn('[auth] sign-in link failed', error),
    )
  void (async () => {
    const { App } = await import('@capacitor/app')
    await App.addListener('appUrlOpen', ({ url }) => complete(url))
    const launch = await App.getLaunchUrl()
    if (launch?.url) complete(launch.url)
  })()
}
