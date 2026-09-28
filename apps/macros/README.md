# MACROcosm

Local-first calorie and macro tracker on the shared `@tracker-engine/*` packages.
Internal id is `macros` (Dexie db, `macros.auth`, `macros://auth-callback`); the
user-facing name is MACROcosm.

Design and roadmap: `docs/design-macros-app.md` at the repo root.

## What's built

- **Today** — calorie ring and macro bars against target, weigh-in, a ranked "cook one of yours",
  and the day summarised one line per sitting.
- **A day** — its own screen, reached from Today or from History: totals against that day's target,
  meals as cards, amounts editable in place, and one "Revert" for everything changed while open.
- **Log** — offline search over seeded foods, portions, servings-or-grams, quick add, barcode,
  photo, described meals, named branded items, and where it was eaten.
- **Recipes** — imported from a link, pasted, or described; a detail screen with the method and
  a serving stepper; cuisine, filters, and a ranked "what should I cook".
- **History** — totals against the target that was in force *then*, filtered by meal and venue.
- **Insights** — measured expenditure with its error bar, calories vs target, weight trend
  with each weigh-in behind it, macro grams per day, home-vs-out, cuisine mix, past check-ins.
- **Coach** — chat that reads your own logs by tool call; anything it proposes logging comes
  back as a card you confirm. Falls back to an offline coach with no key or no session.
- **Settings** — goal and rate, the cold-start facts, appearance, account, data & sync.
- `lib/nutrition.ts` — the only place nutrient arithmetic happens (enforced by
  `npm run lint`).
- `lib/expenditure.ts` — TDEE measured from weight trend and intake, not predicted.
- `lib/recommend.ts` — what to cook: fit, protein density, favourites, recency, cuisine variety.
- `lib/patterns.ts` — home vs out, counted by sitting and compared against target.

## Not built yet

The bowl builder, and the REPutation link (cut — see the design doc's §6 for why, and for the
one rule it existed to protect).

## Importing a recipe from a link

Two calls, and two *visible* stages, because the second is slow and can fail on its own:

1. `recipe-import` (edge function) reads the schema.org `Recipe` JSON-LD that almost every recipe
   site publishes for search engines. Server-side, because those sites send no CORS headers, and
   behind an SSRF guard that accepts only public http(s). It returns **text only** — name,
   servings, cuisine, total time, ingredient lines as written, method.
2. The coach function's `ingredients` mode converts "1/2 pound lean ground beef" to 227 g **at the
   amount stated** — a separate prompt from describing a meal, whose job is the opposite — and the
   client matches each line to a real food row.

Nothing nutritional ever comes off the web page, so a site's own calorie box can't reach the log.
The lines from stage one stay on screen through stage two: nineteen ingredients take most of a
minute, and bundling both behind one spinner made a working import look like a hang and threw the
whole thing away when the model came back busy.

`recipe-import` answers **HTTP 200 even on failure**, with the reason in an `error` field.
supabase-js discards the body of a non-2xx, so every carefully worded reason otherwise reached the
user as "non-2xx status code" — which is how "that page has no recipe" became indistinguishable
from "you're offline". The `coach` function does the same, for the same reason.

## Units

Storage is metric always — kg and cm — and conversion happens only at the edges, in
`@tracker-engine/core`'s units module, shared with REPutation. MACROcosm originally had a units
*setting* that changed nothing: it stored, synced and displayed itself correctly while every screen
printed kg regardless. Nothing was wrong with the value, which is why no unit test caught it — the
guard is an E2E that switches to imperial and reads the screen.

## The AI's limits, and why they matter less now

The free Gemini tier allows **20 requests a day per model** (`GenerateRequestsPerDayPerProject
PerModel-FreeTier=20`, measured). Two things follow.

**The cap is per model, so `coach` tries a chain of them** — 3.8-flash, 3.7, 3.6, 3.5, then the
lites — best first, moving on when one is quota-blocked. Six separate allowances instead of one.
Blocked models are remembered in module scope so a warm instance doesn't pay a round trip per
exhausted model before reaching a working one. No Gemma (no `responseSchema`) and no aliases (they
may resolve to a model already in the list and burn a bucket twice while looking fresh).

**And the paths that don't need a model no longer use one.** `lib/parseIngredient.ts` reads
"1/2 pound lean ground beef" locally — a quantity, a unit and a food, not a language problem — and
`lib/resolveAmount.ts` turns volumes and counts into grams against the matched food's *own* USDA
portions, because a cup of flour is 120 g and a cup of oil is 218 g. A nineteen-line import now
resolves in about a second with no request at all; the model is asked only for the lines the parser
genuinely can't weigh, and if it's unavailable those lines stay visible and uncounted.

Quota errors still report themselves properly: `classify()` reads Google's `QuotaFailure` and
`RetryInfo` and returns which limit was hit and how long to wait, and the client remembers the
cooldown. A quota 429 is **not** retried on the same model — Google's own hint is 30s+ — but the
next model is tried immediately. A 503 gets one retry before moving on.

## Searching for food

`normalizeQuery` in `lib/foodSearch.ts` is applied before both the local match and the string sent
to USDA. It exists because **"80/20 ground beef" returned nothing at all** — not a bad ranking, zero
rows — while "ground beef 80" returns the exact entry. A search that silently returns nothing is the
worst failure this app can have: it is indistinguishable from the food not existing.

### A named product is not an ingredient list

The one place a figure from the model becomes a figure in the app, and it exists because the
alternative was worse. "Costco chicken bake" is in neither database — USDA has the packaged
Kirkland range, not the food court — so the AI path was asked for it and, being told to return
generic ingredient names only, produced a *pizza crust* and a *chicken parmesan*: two invented
weights of foods that are not in it. Wrong, and unfixable by the user, because the rows were wrong
rather than the amounts.

So `coach`'s estimate schema has two shapes and the model picks: `components` for a described meal
(names and grams only, every nutrient still computed from a matched food row), or `item` for one
named product with a published panel. An `item` never logs anything by itself — it fills in
**`CustomFoodPanel`** with every figure editable, says where the numbers came from and how far to
trust them, and saving makes it a food of the user's own. The next one is found locally, offline,
with no model involved. `estimateMeal` sends `components: true`, because a caller filling rows into
an existing draft or recipe has nowhere to put a panel.

### Barcodes on iOS

`BarcodeDetector` is not implemented in any version of WebKit, so gating the scan button on it
removed the feature entirely from Safari, the installed PWA and the App Store build — the platforms
where scanning beats typing by the widest margin. `platform/barcode.ts` keeps `BarcodeDetector` as
the fast path and falls back to a lazily-imported WebAssembly ZXing reader, so availability now
means "there is a camera". The wasm is a content-hashed asset, which makes it cache-first in the
service worker after first use.

### The seed

`scripts/build-food-seed.mjs` generates `src/db/seed/foods.ts` from ~260 everyday queries through
our own `foods` function — so the mapping, the generic-first ranking, the portion labelling and the
zero-energy filter are the ones the app already uses, rather than a second copy of those decisions.
Roughly 1,400 foods, nearly all of them generic or composite (Foundation, SR Legacy, FNDDS), so they
carry portions and micronutrients.

`src/db/seed/staples.ts` is **hand-written and not regenerated**: 46 verified rows that the demo data
refers to by exact description, so a re-run can't silently drop them.

Two consequences worth knowing:

- **The seed is a lazy chunk, versioned.** Over a megabyte of JSON inlined in the main bundle was
  parsed on every launch to usually change nothing. `SEED_VERSION` is compared against localStorage
  and the payload only loads when it moves. Bump it after regenerating.
- **Search is indexed in memory.** `repo.searchFoods` ran a Dexie cursor over the whole table on
  every keystroke. Free at 46 rows, a stall at 1,400 — and 150 lookups in a row (the demo seeder)
  went from fast to timing out. Every write path calls `invalidateFoodIndex`.

`useFoodSearch` still exposes `isSearching` for the long tail that isn't seeded — a screen must never
print "Nothing matched" while it is still looking.

## Logging quickly

The speed difference against MyFitnessPal was never the search — it was that four foods cost four
round trips through a portion screen. Two things fix that:

- **Tick several, log once.** `repo.logFoods` writes them together.
- **The amount is already right.** `repo.lastAmountFor` defaults a portion to what you last had of
  that food, keeping the portion (`2 slices`) rather than the grams it came to. A database default
  of "1 serving" is wrong for almost everybody on almost every food, and re-typing 180 g of chicken
  daily is the friction that ends a food diary.

Portion labels always carry their weight — "4 oz · 113 g", "1 RACC · 112 g" — because USDA's own
labels are a mix of units with no common scale and "1 RACC" means nothing to anybody.

## Recipes: one row or several

Logging a recipe writes **one entry per ingredient** by default. A single row carrying the recipe's
total has no food behind it, so it contributes no micronutrients, can't be re-portioned, can't be
searched, and can't tell you the ricotta was a third of the calories. Logging as one item is still
offered, because a tidy day is a real preference.

Ingredient rows carry `fromRecipeId` — **provenance, not subject**. The row's subject is a food, and
the schema constrains exactly one of `food_id`/`recipe_id`/`quick_add`, so reusing `recipe_id` would
violate it. Without the column, logging a recipe the better way silently detached it from the recipe
and "what you cook" stopped counting it. `cuisineMix` counts one serving per *sitting*, not per row.

## Goals

`Program.targetKg` is what gives a goal an end. A rate is the right *input* for a calorie target and
a useless thing to aim at: nothing ever satisfies "lose 0.5% a week", so reaching a weight you cared
about did nothing at all.

`lib/goal.ts` dates it from the **measured** trend, never the intended rate — an ETA off the plan
says what would happen if the plan were working. Both are returned, because where they disagree that
disagreement is the useful part. `startKg` is captured when the target is set rather than derived
later, so progress has a fixed denominator and the goalposts don't move.

## Where you ate

`LogEntry.venue` is `home | restaurant | takeaway | null`, and `null` is never read as `home` — a
default would be right most of the time and therefore indistinguishable, in the data, from an
answer. Venue belongs to the **sitting**, so `repo.setVenue` writes every row in the occasion at
once and `lib/patterns.ts` counts occasions rather than rows; otherwise a restaurant meal logged as
six items would outvote a home dinner logged as one.

## Commands

```
npm run dev --workspace macros
npm run test --workspace macros
npm run lint --workspace macros     # layering + calc-consistency
```

## Nutrients are integer milligrams

`proteinMg: 31_400` is 31.4 g. Floats in grams reintroduce the drift REPutation fixed by
storing kg canonically and COINcidence by storing minor units — a day's total has to equal
the sum of its rows. `kcal` is an integer; sub-calorie precision is noise.

## The web deploy, and the PWA

Served at **`macrocosm.fitness/app`** from its own Vercel project (`macros-app`, root directory
`apps/macros`), which the marketing site (`sites/macros-site`) rewrites onto:

```
  macrocosm.fitness/app/*  ──rewrite, prefix preserved──▶  macrocosm-app.vercel.app/app/*
```

Two projects, independent deploys: a build failure here can never take the site down, and the
`*.vercel.app` alias is a stable one we assigned rather than the generated hostname — renaming the
project would silently break a rewrite that pointed at the latter.

Three things follow from the subpath and are easy to get wrong:

- **`base: '/app/'`** in `vite.config.ts`. With the default `/`, the browser asks for
  `macrocosm.fitness/assets/…`, which belongs to the site and 404s. `BASE_PATH=/` overrides it for
  the native bundle, where the app *is* at the root.
- **The auth redirect follows `BASE_URL`** (`@tracker-engine/auth`), so a magic link comes back to
  `https://macrocosm.fitness/app/`. That URL has to be in the Supabase project's
  **Authentication → URL Configuration → Redirect URLs**, alongside `macros://auth-callback`.
- **The service worker's scope is `/app/`** (`platform/serviceWorker.ts`). The origin is shared with
  the marketing site, so a root-scope worker would answer the site's requests with the app's shell.

`public/sw.js` is network-first for the shell and cache-first for Vite's hashed assets, and
registration also calls `navigator.storage.persist()` — which matters more than the caching does,
because without it iOS can evict the IndexedDB store that holds every logged day. Registration is
gated on `import.meta.env.PROD`, so `vite dev` never installs one.

The dev server and the E2E suite both run under `/app/` too (`playwright.config.ts`), so nothing
about the path resolution is only exercised in production.

## Native shell

MACROcosm has the same Capacitor setup as REPutation — `capacitor.config.ts`, a committed
`ios/` project, and `contentInset: 'never'` so the web app keeps handling its own safe areas
(the `'always'` default insets the WebView *as well* and leaves a gap at the bottom).

```
npm run build:native        # tsc + vite build with BASE_PATH=/
npm run native:sync         # build, then cap sync
npm run native:ios          # build, sync, open Xcode
```

Two things Xcode owns and a script can't:

- **Icons.** `npm run native:icons` needs `resources/icon.png`; until that art exists the app
  carries Capacitor's placeholder.
- **The HealthKit capability.** `ios/App/App/App.entitlements` declares it and `Info.plist` has the
  usage strings, but the capability itself has to be added once under Signing & Capabilities —
  editing the `.pbxproj` by hand to do it risks corrupting the project for no gain.

Apple Health is **read-only and weight-only**, via `capacitor-health`. That is a deliberate
limit, not a first step: expenditure here is measured from the user's own logs and already
includes training, so reading active energy and adding it to the budget would double-count. There
is nothing to misuse because nothing else is read.
