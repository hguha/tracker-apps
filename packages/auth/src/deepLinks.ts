import type { SupabaseClient } from '@supabase/supabase-js'
import { isNativePlatform } from '@tracker-engine/platform'

const isCallback = (url: URL, callback: URL): boolean =>
  url.protocol === callback.protocol && url.host === callback.host && url.pathname === callback.pathname

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    console.warn('[auth] ignored a link that is not a URL', url)
    return null
  }
}

export async function completeSessionFromUrl(
  client: SupabaseClient | null,
  url: string,
  callbackUrl: string,
): Promise<boolean> {
  const opened = parse(url)
  if (!client || !opened || !isCallback(opened, new URL(callbackUrl))) return false
  const code = opened.searchParams.get('code')
  if (!code) return false
  const flowId = opened.searchParams.get('sb_flow_id')
  const { error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)
  if (error) {
    console.warn('[auth] sign-in link could not be used', error.message)
    return false
  }
  return true
}

export function installAuthDeepLinks(
  getClient: () => SupabaseClient | null,
  callbackUrl: string,
): void {
  if (!isNativePlatform()) return
  const complete = (url: string) =>
    void completeSessionFromUrl(getClient(), url, callbackUrl).catch((error) =>
      console.warn('[auth] sign-in link failed', error),
    )
  void (async () => {
    const { App } = await import('@capacitor/app')
    await App.addListener('appUrlOpen', ({ url }) => complete(url))
    const launch = await App.getLaunchUrl()
    if (launch?.url) complete(launch.url)
  })()
}
