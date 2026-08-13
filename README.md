# Workout Tracker — prototype

A local-first workout tracker. Front end complete against local storage;
no server attached yet. See `../workout-app-spec.md` — §14 is the live
implementation tracker.

## Running it

```bash
npm install
npm run dev
```

Then open the printed `Network:` URL on your phone — same wifi, no build step,
no account. Data lives in that browser's IndexedDB.

```bash
npm test          # 170 unit tests
npm run typecheck # strict TS, no errors
npm run build     # production bundle
node smoke.mjs    # browser walkthrough + screenshots (needs dev server up)
node smoke2.mjs   # Phase 2 interactions
node smoke3.mjs   # auth flow + Phase 2b interactions
```

## What works

| Requirement | Status |
|---|---|
| **Sign in / out, account settings, delete account** | ✅ |
| **Typing a number logs the set** — no confirm step, placeholders from last time | ✅ |
| **PR glow** — the row lights up as soon as its values beat a record | ✅ |
| Last-time header always visible, never behind a tap | ✅ |
| **Exercise detail sheet** — notes, records, last sessions, per-exercise actions | ✅ |
| **Auto session titles** — `Aug 3 Evening · Push`, split inferred from the work | ✅ |
| **Drag to reorder; drop one exercise on another to superset them** | ✅ |
| **Session menu** — rename, change date/time, save as template, discard | ✅ |
| Save as template from the finish sheet, session menu, or history row | ✅ |
| **Repeat any past workout** from history | ✅ |
| **Exercise library** — browse, search, filter, view full taxonomy any time | ✅ |
| Add a custom exercise with muscle + equipment + pattern tagging | ✅ |
| Edit any past workout; add a forgotten set; backdate a session | ✅ |
| Cardio — distance, time, derived pace, kept out of lifting volume | ✅ |
| Dropsets, warmups, AMRAP, backoff sets | ✅ |
| Swipe left to delete, right to duplicate or confirm last time's numbers | ✅ |
| **Explicit rest button**, 10s warning tick, expiry chime, vibration | ✅ |
| **Cardio as one entry block** with live pace, intervals optional | ✅ |
| **Repeat any past session** from the start screen, with its own numbers | ✅ |
| **Empty workouts are discarded**, never saved | ✅ |
| Swipe-dismissable toasts | ✅ |
| **Sound cues** — set logged, PR, rest warning, rest over, workout done | ✅ |
| **7 themes × light/dark, plus a custom accent** with enforced contrast | ✅ |
| **Preview a past workout or template before starting** — confirm, then start | ✅ |
| **Templates** — list with folders, editor, clear plan-vs-workout separation | ✅ |
| **Rest timer** — 1 / 3 / 5-min quick starts plus a custom entry | ✅ |
| Insights — 5 sub-tabs, 21 charts, searchable filters, table view on each | ✅ |
| Body metrics — bodyweight, body fat, waist, resting HR | ✅ |
| Units — lb/kg, mi/km, in/cm, exact round-trip | ✅ |

## Not built yet

Deliberately deferred, in spec order:

- **A live Supabase project.** The backend is *built* — full SQL schema, RLS
  policies and their test suite (`supabase/`), plus the client sync engine
  (`src/sync/`): ordered outbox drain, failure classification with a
  dead-letter queue, delta pull, and the pending-write guard, all tested against
  an in-memory backend. `SupabaseAuthProvider` and `SupabaseBackend` are written
  and auto-selected once `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set;
  with them unset the app runs entirely local-first, as it does today. What
  remains is provisioning an actual project, applying the migrations, and the
  bootstrap-pull progress UI. See **supabase/README.md**.
- **PWA install and offline shell.** Works offline today because IndexedDB is
  the read path, but there's no service worker or manifest yet.
- **Server-scheduled push** for the rest timer (spec §12.3). The in-app timer
  works; a notification with the app closed needs the Cloudflare Worker.
- **The remaining charts** (spec §9). Seventeen of 41 are built, covering every
  color job so the system is proven; the rest follow the same pattern.
- **Plate calculator**, **URL filter state**, **pinned charts**.
- **AI coach** (spec §13) and **progress photos** (spec §4.9).

## Layout

```
src/
  domain/types.ts        Every entity. Mirrors the Postgres schema 1:1.
  lib/
    units.ts             All unit conversion. The only place it happens.
    dates.ts             All timezone-aware bucketing and formatting.
    metrics.ts           Volume, e1RM, working sets, muscle attribution. Pure.
    palette.ts           Region → color. Fixed assignment, never reordered.
    theme.ts             Theme presets, accent contrast enforcement.
    sessionTitle.ts      Auto titles: date + time of day + inferred split.
  db/
    database.ts          Dexie schema + the outbox queue.
    seed/                ~193 base movements, 27 biomarkers.
  auth/                  AuthProvider interface + local implementation.
  data/repository.ts     The single data-access boundary. Nothing else touches Dexie.
  features/
    workout/             The active workout screen — the product.
    insights/            Charts. Lazy-loaded so logging never pays for ECharts.
    auth/                Sign-in and account screens.
    library/             The exercise library.
    timer/               Rest timer state and all sound cues.
    history/  home/  profile/
  components/            Card, Button, SwipeableRow, DragList, FilterSheet, Toast.
  styles/
    tokens.css           Chart palette + status colors. NOT themeable.
    themes.css           The 7 presets. Surfaces, ink, accent.
```

Four conventions worth knowing before editing:

**Storage is always metric.** `weightKg`, `distanceM`, centimeters. Conversion
happens only in `lib/units.ts`, at the display boundary. Storing display units
would push conversion into every chart and PR comparison, where one miss
silently corrupts a year of analytics.

**Nothing imports Dexie except `data/repository.ts`.** Screens call the
repository. That's what keeps the sync layer swappable.

**A set with values is a logged set.** There is no confirm step and no separate
"completed" toggle for the user to manage — `isCompleted` is derived on write.
An untouched row is a placeholder and is ignored by every metric, then discarded
on finish. A session with nothing logged is discarded outright.

**Nothing above `src/auth/types.ts` knows how auth works.** Screens call
`useAuth()`. Swapping the local provider for Supabase is one file.

**Themes may not touch chart series colors.** `styles/themes.css` controls
surfaces, ink, and the accent. The 7 body-part colors in `tokens.css` are fixed
because their specific ordering is what passes the colorblind-separation checks,
and because a color has to keep meaning the same body part. Charts draw marks in
categorical slot 1, never the accent — every theme accent but Mono measures
inside the ΔE≥15 series floor of some body-part color.

## Comments: keep them to an absolute minimum

The code should read on its own; reorganize or rename rather than annotate. Add a
comment ONLY when it earns its place — a non-obvious *why* (a workaround, an
invariant, a subtle ordering constraint), never a *what* the code already states.
Prefer one terse line over a block. No banners, no restating signatures, no
"// loop over exercises". When editing, delete comments that have gone stale or
that narrate the obvious. The existing comments in this repo are the intended
density ceiling, not a target — most functions have none.

## Deploying

Lives at `hirshguha.com/workout-tracker`, from its own Vercel project that the
website proxies to. See **DEPLOYING.md** — including the service-worker scope
trap to avoid before Phase 4.

## Where the design decisions live

`../workout-app-spec.md` is the reference. Section numbers appear in comments
throughout the source where a non-obvious choice traces back to it — e.g.
`SetRow.tsx` cites §6.2 for why typing a value is what logs a set.
