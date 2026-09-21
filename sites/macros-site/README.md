# MACROcosm — product site

The marketing site for [MACROcosm](https://macrocosm.fitness), the local-first
calorie and macro tracker. Astro + Tailwind, static output, no client framework.
The layout, nav, hero, phone mock-ups and FAQ come from
`@tracker-engine/site-kit`, shared with REPutation's site.

```bash
npm run dev --workspace macros-site      # http://localhost:4321
npm run build --workspace macros-site    # → dist/
npm run check --workspace macros-site    # astro check (types + templates)
```

## Editing content

All copy lives in `src/data/`, so changing the site rarely means opening a
component:

| File | What's in it |
| --- | --- |
| `data/site.ts` | Name, tagline, store links, web-app and privacy URLs, nav, hero pill, CTA, the proof-point numbers |
| `data/features.ts` | The three spotlight sections, the coach transcript, the feature-card grid, the gallery order, the FAQ |

`src/site.ts` is what the kit's components import as `@site` (aliased in
`astro.config.mjs`); it only re-exports the above.

**Store links.** `site.stores` has one key per store worth mentioning, and three
states: a URL links the badge, `null` renders a greyed-out "Coming soon to the
App Store", and a **missing key renders nothing at all**. `appStore` is `null`
until the listing exists; there is no `playStore` key, because there is no
Android build and a "coming soon" badge would promise one. The JSON-LD
`operatingSystem` follows from the same keys.

**The numbers in `stats` are countable.** 1,509 seeded foods
(`apps/macros/src/db/seed/`), 17 charts across the Insights tabs. Recount them
before changing either, rather than rounding.

## Screenshots

Every image is a real capture of the shipping app, taken from the demo history
the app itself can load (Settings → Data & sync → Load demo data), which writes
through the repository like any other path. Nothing is a mockup.

```bash
npm run screens --workspace macros-site                  # all of them
npm run screens --workspace macros-site -- --headed      # watch it happen
npm run screens --workspace macros-site -- --only today,coach
```

`tools/capture.mjs` starts the app's dev server with **no backend configured**,
walks first-run setup, loads the demo history, then drives the app and shoots
each screen in light and dark at 3×. Captures land in `src/assets/screens/` so
Astro's image pipeline emits WebP at the sizes the page renders (~200 kB PNG in,
~15–40 kB out). The shared harness is in
`packages/site-kit/tools/capture-kit.mjs`.

Adding a screen to the gallery is one line in `data/features.ts`; a name with no
matching file throws at build time rather than shipping an empty phone.

## Social card

`public/og.png` is generated from the `/og-card` route, so it uses the real mark,
type and screenshot:

```bash
npm run build --workspace macros-site && npm run og --workspace macros-site
```

Regenerate and commit it after a redesign.

## Deploying

Static output, deployed from this directory as its own Vercel project
(`macros-site`, root directory `sites/macros-site`). `vercel.json` rewrites
`/app` and `/app/*` onto the **app's** deployment, so `macrocosm.fitness/app` is
the PWA and a build failure in one project can never take down the other. The
app's own `vite.config.ts` builds with `base: '/app/'` for exactly this reason.
