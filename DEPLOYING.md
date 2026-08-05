# Deploying

Served at **`hirshguha.com/workout-tracker`** from its own Vercel project, which
the website project proxies to. Two repos, two projects, independent deploys — a
build failure here can never block `hirshguha.com`.

```
  hirshguha.com/workout-tracker/*
            │
            │  rewrite (prefix stripped)
            ▼
  workout-tracker-<hash>.vercel.app/*
```

## One-time setup

### 1. Push this repo to GitHub

```bash
git remote add origin git@github.com:hguha/workoutTracker.git
git push -u origin main
```

### 2. Create the Vercel project

On [vercel.com/new](https://vercel.com/new), import the repo. Vercel reads
`vercel.json`, so the framework, build command, and output directory are already
correct — don't override them.

Deploy, then copy the production URL (`workout-tracker-….vercel.app`).

**Optional but recommended:** give it a stable alias under Project → Settings →
Domains, e.g. `workout-tracker-hg.vercel.app`. The rewrite below points at a
hostname, and an alias means a future project rename doesn't silently break it.

### 3. Add the rewrite to the website repo

In `HirshGuhaNewWebsite`, add to `next.config.js`:

```js
async rewrites() {
  return [
    {
      source: '/workout-tracker',
      destination: 'https://workout-tracker-hg.vercel.app',
    },
    {
      source: '/workout-tracker/:path*',
      destination: 'https://workout-tracker-hg.vercel.app/:path*',
    },
  ]
}
```

Both entries are needed: the first matches the bare path, the second everything
under it. `:path*` alone does not match the parent.

Push. That's the only change the website ever needs.

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
