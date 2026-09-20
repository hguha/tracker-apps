import { isNativePlatform } from '@tracker-engine/platform'

/**
 * Registers the offline shell, and asks for storage that survives.
 *
 * The explicit scope is load-bearing: the app is served at `macrocosm.fitness/app`, an origin it
 * shares with the marketing site, so a root-scope worker would answer the site's requests with the
 * app's shell. `import.meta.env.BASE_URL` is the same `/app/` the build used, so the two can't drift.
 *
 * `persist()` matters more than the caching does. Without it, iOS — and any browser under storage
 * pressure — may evict the IndexedDB store that holds every logged day. The prompt is silent on
 * most platforms; we ask on every load and let the browser decide.
 *
 * Production only: a stale cache during `vite dev` is the worst debugging loop there is.
 */
const SW_URL = import.meta.env.BASE_URL + 'sw.js'
const SW_SCOPE = import.meta.env.BASE_URL

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return
  // The native shell serves the bundle itself; a worker on top of that adds nothing but
  // update staleness.
  if (isNativePlatform()) return

  try {
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
  } catch (error) {
    console.warn('Service worker registration failed:', error)
  }

  if (navigator.storage?.persist) {
    try {
      const already = await navigator.storage.persisted?.()
      if (!already) await navigator.storage.persist()
    } catch {
      // The probe throws on some browsers; treat that as unsupported.
    }
  }
}
