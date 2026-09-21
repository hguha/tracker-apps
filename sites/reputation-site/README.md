# REPutation — product site

The marketing site for [REPutation](https://reputation.fitness), the local-first
workout tracker. Astro + Tailwind, static output, no client framework. The
layout, nav, hero, phone mock-ups and FAQ come from `@tracker-engine/site-kit`,
shared with MACROcosm's site.

```bash
npm run dev --workspace reputation-site      # http://localhost:4321
npm run build --workspace reputation-site    # → dist/
npm run check --workspace reputation-site    # astro check (types + templates)
```

It is a workspace of the monorepo, so `npm install` at the repo root installs it.

## Editing content

All copy lives in `src/data/`, so changing the site rarely means opening a
component:

| File | What's in it |
| --- | --- |
| `data/site.ts` | Name, tagline, store links, web-app and privacy URLs, nav, hero pill, CTA, hero stats |
| `data/features.ts` | The three spotlight sections, the coach transcript, the feature-card grid, Leagues, the gallery order, the FAQ |

`src/site.ts` is what the kit's components import as `@site` (aliased in
`astro.config.mjs`); it only re-exports the above.

**Store links.** `site.stores` has one key per store worth mentioning, and three
states: a URL links the badge, `null` renders a greyed-out "Coming soon to the
App Store", and a **missing key renders nothing at all**. `appStore` is live;
there is no `playStore` key, because there is no Android build and a "coming
soon" badge would promise one. Adding Android later is one line here, and the
JSON-LD `operatingSystem` follows from the same keys.

## Screenshots

Every image is a real capture of the shipping app. Nothing is a mockup, and
there are no hand-drawn recreations to drift out of date.

```bash
npm run screens --workspace reputation-site                 # regenerate all of them
npm run screens --workspace reputation-site -- --headed     # watch it happen
```

The pipeline in `tools/` has three stages:

1. **`demo-seed.ts`** builds a twenty-week training log — about sixty sessions,
   840 sets, five body-metric series, four templates, and one session left in
   progress. It runs inside the *app* repo's Vitest against `fake-indexeddb`, so
   every write goes through the real data layer. That matters because personal
   records and the last-performance cache are derived: letting `finishWorkout`
   compute them is the only way the screenshots can show what the product would
   actually show.
2. **`capture.mjs`** starts the app's dev server, writes that dump straight into
   a real browser's IndexedDB, then drives the app — signing in device-only,
   switching tabs, opening sheets, running a coach critique — and shoots each
   screen in light and dark at 3×.
3. Captures land in `src/assets/screens/` so Astro's image pipeline emits WebP at
   the sizes the page renders (~200 kB PNG in, ~10–25 kB out).

The app is `apps/reputation` in this monorepo; override with `--app <path>` or
`FITNOTE_APP_DIR`. The parts that aren't REPutation-specific — starting the app
with its backend disabled, sizing a phone, writing the file — live in
`packages/site-kit/tools/capture-kit.mjs`.

Adding a screen to the gallery is one line in `data/features.ts`; `lib/screens.ts`
globs the directory, so there is no import to remember. A name with no matching
file throws at build time rather than shipping an empty phone.

## Social card

`public/og.png` is generated from the `/og-card` route, so it uses the real mark,
type and screenshot:

```bash
npm run build --workspace reputation-site && npm run og --workspace reputation-site
```

Regenerate and commit it after a redesign.

## Deploying

Its own Vercel project (`reputation-site`, root directory `sites/reputation-site`).
`vercel.json` rewrites `/app` and `/app/*` onto the **app's** deployment, so
`reputation.fitness/app` is the PWA and a build failure in one project can never
take down the other. The app's own `vite.config.ts` builds with `base: '/app/'`
for exactly that reason. The production domain is set in `astro.config.mjs`
(`site`), which is what makes canonical URLs and the Open Graph image absolute.
