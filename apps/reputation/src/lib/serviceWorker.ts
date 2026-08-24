// Registers the service worker and asks for persistent storage. The explicit
// scope matters: the origin is shared with the marketing site (DEPLOYING.md),
// so a root-scope worker would intercept its requests too. persist() is the
// point — without it iOS can evict the IndexedDB store under storage pressure.
// Prod only, so a stale cache never gets in the way of `vite dev`.
import { isNativePlatform } from './platform'

const SW_URL = import.meta.env.BASE_URL + 'sw.js'
const SW_SCOPE = import.meta.env.BASE_URL

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return
  // The native shell serves the bundle itself; a SW layer is redundant and only
  // risks update staleness.
  if (isNativePlatform()) return

  try {
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
  } catch (err) {
    console.warn('Service worker registration failed:', err)
  }

  if (navigator.storage?.persist) {
    try {
      const already = await navigator.storage.persisted?.()
      if (!already) await navigator.storage.persist()
    } catch {
      // The probe throws on some browsers; treat as unsupported.
    }
  }
}
