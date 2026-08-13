/**
 * Service worker for FitNote.
 *
 * Two goals: (1) keep the app openable when offline, and (2) do NOT get in the
 * way of a fresh deploy. Vite fingerprints every asset filename with a content
 * hash, so once a hash is in the cache it can serve from there forever; new
 * hashes come in on the next network fetch. index.html is the only path with a
 * stable URL that changes contents, so it must go to network first.
 *
 * SCOPE: this worker is registered with an explicit scope of
 * /workout-tracker/ because the origin also hosts the marketing site
 * (DEPLOYING.md). It only ever intercepts requests inside its scope.
 */

const CACHE_NAME = 'fitnote-v1'
const SCOPE_PATH = new URL(self.registration.scope).pathname // '/workout-tracker/'

self.addEventListener('install', (event) => {
  // Precache just the app root so an offline reload has something to open;
  // the hashed assets follow on the first successful load.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(SCOPE_PATH)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (!url.pathname.startsWith(SCOPE_PATH)) return

  // Never cache Supabase or anything else that isn't a static asset.
  if (url.pathname.includes('/rest/v1/') || url.pathname.includes('/auth/v1/')) return

  const isNavigation = req.mode === 'navigate' || req.destination === 'document'

  if (isNavigation) {
    // Network-first for the shell: a deploy takes effect immediately when online,
    // and the cached copy is the offline fallback.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const cache = await caches.open(CACHE_NAME)
          cache.put(SCOPE_PATH, res.clone())
          return res
        } catch {
          const cached = await caches.match(SCOPE_PATH)
          if (cached) return cached
          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
        }
      })(),
    )
    return
  }

  // Hashed assets (JS, CSS, fonts, images): stale-while-revalidate. Serve the
  // cache immediately and refresh in the background, so offline works and a
  // slow network never stalls a page load.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res.ok) void cache.put(req, res.clone())
          return res
        })
        .catch(() => null)
      return cached ?? (await network) ?? new Response('', { status: 504 })
    })(),
  )
})
