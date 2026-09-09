# MACROcosm

Local-first calorie and macro tracker on the shared `@tracker-engine/*` packages.
Internal id is `macros` (Dexie db, `macros.auth`, `macros://auth-callback`); the
user-facing name is MACROcosm.

Design and roadmap: `docs/design-macros-app.md` at the repo root.

## What's built

- **Today** — calorie ring and macro bars against target, meals, weigh-in.
- **Log** — offline search over seeded foods, portions, servings-or-grams, quick add, barcode,
  photo, described meals, and where it was eaten.
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
