# Design — MACROcosm (calorie & macro tracking)

**Status: plan, nothing built.** Delete this file once the app ships and replace it with a
roadmap of what's left.

Name in the vein of REPutation / COINcidence: **MACROcosm** — macros, and the whole picture
of what you eat. Alternates if it doesn't land: PROTEINtial, MEALstone.

Internal id stays **`macros`** everywhere load-bearing (`apps/macros`, Dexie db `macros`,
storage key `macros.auth`, scheme `macros://auth-callback`), the same way REPutation stays
`fitnote` and COINcidence stays `ledger` internally.

## What it has to do

1. Log what you ate, fast — the whole app lives or dies on this. Barcode, photo, search,
   recent/frequent, saved meals.
2. Show calories and macros against a target that's derived from your goal (gain / lose /
   maintain) and adjusted by what actually happened to your weight.
3. Answer questions and build recipes with AI, without inventing numbers.
4. Use REPutation's training and bodyweight data instead of asking you to re-enter it.

## Food data: what's actually free

| Source | Free? | Use |
|---|---|---|
| **USDA FoodData Central** | Yes, genuinely — API key from api.data.gov, public-domain data | Primary. Foundation + SR Legacy for whole foods, **Branded Foods** (~2M items) for packaged, and branded rows carry `gtinUpc`, so **barcodes resolve from USDA alone for US products** |
| **Open Food Facts** | Yes, open data (ODbL), no key | Fallback and international coverage. Crowd-sourced, so quality varies — treat as lower-confidence than USDA |
| Nutritionix / Edamam / FatSecret | Nominally free tiers, all gated, attribution-bound or approval-bound | Avoid. Same trap as COINcidence's aggregators — don't build a dependency on a free tier that can close |

**Ship a local subset.** FDC publishes full bulk downloads, so the common-foods table can be
seeded into IndexedDB the way REPutation seeds its exercise library. Offline search on day
one, no API call for the foods people actually eat, and the network is only for the long tail
and barcodes. This is the single biggest design decision here — it makes the app fast and
offline-first rather than a thin API client.

**Barcode scanning, on-device and free:** native uses `@capacitor-mlkit/barcode-scanning`
(ML Kit, on-device); web uses `BarcodeDetector` where it exists and a WASM fallback
(`@zxing/library`) otherwise. Verify Safari/iOS support for `BarcodeDetector` at build time
rather than trusting it — historically absent, which is why the fallback isn't optional.

## The accuracy rule

Borrowed from what the workout app learned the hard way about calculation consistency, and
it's stricter here because AI is in the loop:

> **AI proposes, the food database computes.** A photo or a chat message may produce a *list
> of items and quantities*. Every gram and calorie then comes from a matched food row. The
> model never emits a macro number that reaches storage.

Consequences: photo logging lands as a **draft the user confirms**, with each item showing
what it matched and how confident that match is; a recipe's totals are the sum of its
matched ingredients, so editing an ingredient updates them; and every entry stores its
source (`usda` / `off` / `photo-estimate` / `manual`) so the app can be honest about which
numbers are solid. Anything unmatched is explicitly an estimate, never silently averaged in.

## Architecture

Reused from the engine with no changes: `@tracker-engine/local-first` (outbox, delta pull,
dead-letter, authorship classes), `/auth` (email code + password, the whole account
lifecycle), `/ui`, `/core` (dates, colour, `cn`), `/platform` (haptics, files, notify,
status bar), `/ai-coach` (`runToolLoop` for Gemini tool-calling).

New and app-specific:

- `domain/` — `Food`, `FoodPortion`, `LogEntry`, `Meal`, `Recipe`, `Target`, `DayTotals`.
- `lib/nutrition.ts` — the canonical calculation layer, same role as REPutation's
  `lib/metrics.ts`: portion → grams → macros, day/week totals, target derivation, TDEE.
  Nothing else may do this arithmetic; the architecture check should enforce it, exactly as
  it enforces `volumeLoadKg` today.
- `data/foods.ts` — local FDC subset + remote lookup + barcode resolution, with the
  USDA→OFF fallback order in one place.
- `sync/macroSchema.ts` — foods are **server-authored** (read-only reference data, pull-only);
  log entries, meals, recipes and targets are **client-authored**. Same two-class split
  COINcidence uses for bank rows vs manual entries, which is why that abstraction already
  exists.
- Edge functions: `coach` (Gemini text + tools), `vision` (photo → item list), `foods`
  (proxies USDA so the API key stays server-side).

**Never ship the USDA key to the client.** It goes in the `foods` edge function, alongside
the existing pattern for `GEMINI_API_KEY`.

## Units

Store grams as the canonical unit for mass and millilitres for volume, integers where
possible, and convert at the edges — the same discipline as kg for weight and minor units for
money. Display in the user's preference.

## Connecting to REPutation — decide this before writing code

This is the one genuinely new architectural question, and getting it wrong is expensive.

**Bodyweight already lives in REPutation** (`metricEntries`), and a weight gain/loss app is
useless without it. Duplicating it in a second app means two truths for one number.

Three options:

1. **Same Supabase project as REPutation, shared `auth.users`, a shared `body_metrics`
   table** that both apps read and write under RLS. One sign-in, one bodyweight history,
   trivial cross-app reads. Cost: the two apps are coupled at the database, and the
   "one project per app" pattern breaks.
2. **Separate project, opt-in derived export.** REPutation publishes a small signed summary
   (training days, session energy estimate, bodyweight trend) that MACROcosm pulls. Keeps
   projects independent and matches the social-leagues principle — publish derived numbers,
   never raw data. Cost: a sync path to build and keep working, and bodyweight still has two
   homes unless one app owns it.
3. **Extract body metrics into the engine** as a shared domain + table, with whichever
   project hosts it treated as the owner. Cleanest long-term, most work now.

**Recommendation: (1) now, structured so (3) is the escape hatch.** Put MACROcosm on
REPutation's project, and put the body-metrics domain in a `@tracker-engine/body` package
from the start so ownership can move later without touching either app's screens. Bodyweight
is not incidental shared data — it's the join key between the two apps, and both need to
write it (you weigh yourself in whichever app you happen to open).

What flows each way:
- **REPutation → MACROcosm**: training days, per-session energy estimate, bodyweight trend,
  goal. Turns a static calorie target into one that reacts to a hard training week.
- **MACROcosm → REPutation**: calories and protein for the previous day, so the coach can
  tell the difference between under-recovering and under-eating.

## Screens

Mirrors the shape both existing apps use, so it's immediately familiar:

- **Today** — calories ring + macro bars against target, meals in order, quick-add row.
- **Log** — the fast path: barcode / photo / search / recents / saved meals. Should be
  reachable in one tap from anywhere, like the workout app's centre action.
- **History** — days with totals and a weight-trend overlay.
- **Insights** — adherence, macro split over time, weight change vs. calorie balance
  (the chart that tells you whether the target is actually right).
- **Coach** — questions, meal ideas, recipes, and a weekly target adjustment based on
  measured weight change rather than a formula.
- **Settings** — goal, targets, units, account, data, sync.

## Phases

1. **Log + Today.** Local FDC subset, search, manual entry, portions, day totals, targets.
   The app is useful at the end of this phase and nothing after it is required.
2. **Barcode + remote lookup.** ML Kit / BarcodeDetector, USDA `gtinUpc`, OFF fallback,
   `foods` edge function.
3. **Photo logging.** `vision` edge function, confirm-and-edit draft flow, match confidence.
4. **REPutation link.** Shared body metrics, training-aware targets, calories back to the
   coach.
5. **Recipes + coach.** Recipe builder with computed macros, saved meals, weekly adjustment.
6. **Breadth.** Micronutrients, fibre/sugar/sodium goals, water, streaks and badges (the
   badge system is already generic enough to lift).

## Not doing

- **Meal-plan delivery / grocery ordering** — commerce, not tracking.
- **Restaurant menu databases** — the good ones are paid; branded + photo covers most of it.
- **Medical or clinical claims.** Targets are informational. Worth stating in-app given the
  App Store's health-app scrutiny, and worth checking against guideline 1.4.1 before
  submission.

## Free-tier watchpoints

- USDA FDC: 1,000 req/hour per key by default (3,600 with a data.gov key). The local subset
  is what keeps normal use off the API entirely.
- Gemini free tier is rate-limited — the coach must degrade to an offline path, as
  REPutation's already does.
- Supabase free: 500MB. A shipped foods subset lives in IndexedDB, not Postgres; only user
  logs are stored server-side.
