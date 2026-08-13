// Offline shell for FitNote. index.html is network-first so a deploy takes
// effect at once; Vite's content-hashed assets are cache-first since a given
// URL never changes contents. Scoped to the registration path — the origin is
// shared with the marketing site (DEPLOYING.md).

const CACHE_NAME = 'fitnote-v1'
const SCOPE_PATH = new URL(self.registration.scope).pathname // '/workout-tracker/'

self.addEventListener('install', (event) => {
  // The app root is enough to open offline; hashed assets fill in on first load.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(SCOPE_PATH)))
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

  // Hashed assets: serve cache, refresh in the background.
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
