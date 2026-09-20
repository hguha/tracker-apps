# @tracker-engine/site-kit

The marketing sites' shared chrome. Astro components with **no brand facts in them**: the layout,
nav, hero, the fan of phone mock-ups, the spotlight sections, the feature grid, the coach
transcript, the FAQ and the closing CTA — plus the screenshot and OG-card tooling.

It exists because there are two sites. One site does not tell you which parts are shared.

## How a site uses it

Each site provides a single content module and aliases it to `@site`, which is what every component
in here imports:

```js
// astro.config.mjs
resolve: { alias: { '@site': fileURLToPath(new URL('./src/site.ts', import.meta.url)) } },
ssr: { noExternal: ['@tracker-engine/site-kit'] },   // the kit ships .astro sources, not a build
```

`src/site.ts` re-exports `site`, `stats`, `spotlights`, `cards`, `gallery`, `faqs`,
`conversation`, and `screen`/`hasScreen`. The shapes are exported from this package
(`SiteConfig`, `Spotlight`, …), so a site checks itself with `satisfies SiteConfig`.

An alias rather than props: the alternative was threading a config object through four levels of
component to reach a nav link, and a `Phone` deep inside a stack still needs the screenshot index.

```astro
---
import Base from '@tracker-engine/site-kit/layouts/Base.astro'
import Hero from '@tracker-engine/site-kit/components/Hero.astro'
---
<Base>
  <Hero><Fragment slot="headline">…</Fragment></Hero>
</Base>
```

## What stays in the site

- **The content** (`src/data/*`), which is the point.
- **The palette.** `styles/base.css` here holds the neutrals, type scale and the four utilities
  every section is built from; the site imports it and then overrides `--color-accent` and adds its
  app's category colours.
- **The headline.** A slot, not config — a wordmark mid-sentence with a shimmer on half a word is
  typography, not data.
- **The mark.** Components render `/icon.svg` from the site's own `public/`, which is the app's
  actual icon rather than a second copy of it.
- **Sections only one product has** — REPutation's Leagues ladder.
- **The screenshot script.** `tools/capture.mjs` per site, because the taps that reach a screen are
  the app's. Only the parts that aren't — starting the app with its backend disabled, sizing a
  phone, writing the file — live here, in `tools/capture-kit.mjs`.

## Tools

```bash
npm run screens --workspace <site>   # site's own tools/capture.mjs, on capture-kit
npm run og --workspace <site>        # renders /og-card at 1200×630 into public/og.png
```

`og.mjs` starts and stops Astro's preview **daemon** (`astro preview` forks a server and exits, so
there is no child process to kill — it is stopped by name).
