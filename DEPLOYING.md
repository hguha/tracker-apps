# Deploying

Served at **`hirshguha.com/workout-tracker`** from its own Vercel project, which
the website project proxies to. Two repos, two projects, independent deploys — a
build failure here can never block `hirshguha.com`.

```
  hirshguha.com/workout-tracker/*
            │
            │  rewrite, prefix preserved
            ▼
  workout-tracker-khaki-five.vercel.app/workout-tracker/*
```

Both are live. The rewrite lives in `HirshGuhaNewWebsite/next.config.mjs`.

## Setup — already done

For reference, since this is the kind of thing you only touch once:

1. **This repo** is on GitHub at `hguha/workoutTracker`.
2. **Its Vercel project** builds from `vercel.json` — framework, build command,
   and output directory all come from there, so don't override them in the
   dashboard.
3. **The rewrite** is in `HirshGuhaNewWebsite/next.config.mjs`, pointing at
   `workout-tracker-khaki-five.vercel.app`.

The rewrite needs **two** entries, because `:path*` does not match the bare
parent path — without the first, `/workout-tracker` itself would 404:

```js
{ source: '/workout-tracker',         destination: `${ORIGIN}/workout-tracker` },
{ source: '/workout-tracker/:path*',  destination: `${ORIGIN}/workout-tracker/:path*` },
```

Note the prefix is **preserved**, not stripped. The app's own `vercel.json` also
rewrites `/workout-tracker/*` onto its files, so both the proxied URL and the
bare `*.vercel.app` URL work — the latter is handy for checking a deploy before
it's live on the domain.

### Worth doing at some point

Give the Vercel project a stable alias (Project → Settings → Domains), e.g.
`workout-tracker-hg.vercel.app`, and point the rewrite at that instead. The
generated `khaki-five` hostname is tied to the current project name; renaming the
project would silently break the rewrite.

## After that

Push to this repo → Vercel builds and deploys → live at
`hirshguha.com/workout-tracker`. The website is not rebuilt and is not involved
beyond forwarding the request.

## Verifying a deploy

```bash
curl -sI https://hirshguha.com/workout-tracker | head -3
```

Expect `200`. Then load it in a browser and confirm the sign-in screen renders
with its blue button — a blank or unstyled page almost always means an asset path
problem (see below).

To test the website's rewrite locally before pushing it:

```bash
cd ~/HirshGuhaNewWebsite && npx next build && npx next start -p 4200
curl -s http://127.0.0.1:4200/workout-tracker | grep '<title>'   # → Workout Tracker
```

This proxies to the *live* app deployment, so it verifies the rewrite itself
rather than a local build.

## The base path

`vite.config.ts` sets `base: '/workout-tracker/'`, so built asset URLs are
absolute from that prefix:

```html
<script src="/workout-tracker/assets/index-abc123.js">
```

This is required. With the default `base: '/'`, the browser would request
`hirshguha.com/assets/…` — which belongs to the website, not this app, and 404s.

To host at a bare domain instead:

```bash
BASE_PATH=/ npm run build
```

## Before shipping the service worker

Not yet built (spec §5.8, Phase 4), but worth writing down now because it is the
one part of this topology with a real trap.

A service worker's scope is capped by the path it is served from, and scope is
per **origin** — and under this setup the app shares an origin with the website.
So the worker must be registered with an explicit scope:

```ts
navigator.serviceWorker.register('/workout-tracker/sw.js', {
  scope: '/workout-tracker/',
})
```

Registered at the root instead, it would intercept requests for
`hirshguha.com` itself and start serving the workout tracker's cached shell in
place of the website. Verify in DevTools → Application → Service Workers that the
scope reads `/workout-tracker/` before shipping.

The same origin-sharing is why a subdomain would have been the simpler choice for
the PWA specifically; the subpath is a deliberate trade for the nicer URL.
