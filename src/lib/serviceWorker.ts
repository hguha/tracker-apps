/**
 * Service worker registration and IndexedDB eviction protection.
 *
 * The app is served at `/workout-tracker/` from an origin it shares with the
 * marketing site (DEPLOYING.md). A service worker's scope is capped by the
 * path it is served from; registering at the origin root would intercept the
 * marketing site's requests too. The worker file therefore lives at
 * `/workout-tracker/sw.js` and is registered with an explicit scope.
 *
 * `navigator.storage.persist()` is the more important call here. Without it,
 * iOS (and desktop browsers under storage pressure) may evict the IndexedDB
 * store that holds every set the user has ever logged. Persistence is silent
 * to grant — the browser prompts only on some platforms, and only in a PWA
 * install context — so we ask on every load and trust the browser to decide.
 *
 * Off in dev to avoid a stale cache while iterating; register.js hardcodes
 * clientsClaim so a real install rolls out to open tabs on next load.
 */

const SW_URL = import.meta.env.BASE_URL + 'sw.js'
const SW_SCOPE = import.meta.env.BASE_URL

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  try {
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
  } catch (err) {
    console.warn('Service worker registration failed:', err)
  }

  // Ask for persistent storage. Returns false if the browser declined or
  // doesn't support the API — we still logged the request; there's no fallback.
  if (navigator.storage?.persist) {
    try {
      const already = await navigator.storage.persisted?.()
      if (!already) await navigator.storage.persist()
    } catch {
      // Some browsers throw on the probe; treat as unsupported.
    }
  }
}
