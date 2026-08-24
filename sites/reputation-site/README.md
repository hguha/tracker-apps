# REPutation — product site

The marketing site for [REPutation](https://hirshguha.com/workout-tracker), the
local-first workout tracker. Astro + Tailwind, static output, no client framework.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # → dist/
npm run check    # astro check (types + templates)
```

## Editing content

All copy lives in `src/data/`, so changing the site rarely means opening a
component:

| File | What's in it |
| --- | --- |
| `data/site.ts` | Name, tagline, store links, web-app and privacy URLs, hero stats |
| `data/features.ts` | The three spotlight sections, the feature-card grid, the gallery order, the FAQ |

**Store links.** `site.stores.appStore` and `.playStore` are `null` until the
listings are live, which renders each badge as a greyed-out "Coming soon to the
App Store". Paste the URLs in and they become real links — that is the whole
launch-day change.

## Screenshots

Every image is a real capture of the shipping app. Nothing is a mockup, and
there are no hand-drawn recreations to drift out of date.

```bash
npm run screens              # regenerate all of them
npm run screens -- --headed  # watch it happen
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

It expects the app repo beside this one. Override with `--app <path>` or
`FITNOTE_APP_DIR`.

Adding a screen to the gallery is one line in `data/features.ts`; `lib/screens.ts`
globs the directory, so there is no import to remember. A name with no matching
file throws at build time rather than shipping an empty phone.

## Social card

`public/og.png` is generated from the `/og-card` route, so it uses the real mark,
type and screenshot:

```bash
npm run build && node tools/og.mjs
```

Regenerate and commit it after a redesign.

## Deploying

Static output — point any host at `dist/`. On Vercel the defaults are correct
(build `npm run build`, output `dist`). Set the production domain in
`astro.config.mjs` (`site`) so canonical URLs and the Open Graph image resolve
absolutely.
