# Workout Tracker

A local-first workout tracker. Runs entirely offline in the browser and syncs to
Supabase when signed in. See `workout-app-spec.md` — §14 lists what remains.

## Running it

```bash
npm install
npm run dev
```

Then open the printed `Network:` URL on your phone — same wifi, no build step,
no account. Data lives in that browser's IndexedDB.

```bash
npm test          # 375 unit tests
npm run typecheck # strict TS, no errors
npm run build     # production bundle
```

## Features

### Logging
- **Typing a number logs the set** — no confirm step, placeholders from last time
- **PR glow** — the row lights up as soon as its values beat a record
- Last-time header always visible, never behind a tap
- Drag to reorder; drop one exercise on another to superset them
- Swipe left to delete, right to duplicate or confirm last time's numbers
- Cardio as one entry block with live pace; kept out of lifting volume
- Auto session titles (`Aug 3 Evening · Push`, split inferred from the work)
- Session menu — rename, change date/time, save as template, discard
- Empty workouts are discarded, never saved
- Explicit rest button, 10s warning tick, expiry chime, vibration
- Sound cues — set logged, PR, rest warning, rest over, workout done
- Exercise detail sheet — notes, records, last sessions, per-exercise actions

### Templates and repeat
- Templates — list with folders, editor, clear plan-vs-workout separation
- Preview a past workout or template before starting — confirm, then start
- Repeat any past workout from history or the start screen
- Save as template from the finish sheet, session menu, history row, or preview

### History and editing
- History list + calendar + filters + pagination
- Edit any past workout; add a forgotten set; backdate a session

### Insights
- 5 sub-tabs (Overview, Strength, Volume, Habit, Body), 22 charts
- Searchable filters, table view on every chart
- Body metrics — 28 biomarker definitions (bodyweight, body fat, waist, resting HR, …)

### Exercise library
- Browse, search, filter, view full taxonomy any time
- Add a custom exercise with muscle + equipment + pattern tagging
- Movement + equipment split: one library row per movement, equipment chosen at add time

### Themes and accessibility
- 7 themes × light/dark, plus a custom accent with enforced contrast
- Colorblind-separated body-part palette (ΔE ≥ 15) — themes never touch chart colors

### Coach (AI)
- Critique, plan, ask, encouragement — mock (offline) + Gemini (signed-in)
- De-identified summary: no names, notes, or absolute dates leave the device
- Plans materialize as templates you can edit before starting

### Auth, sync, portability
- Magic link with OTP fallback; anonymous device-only mode
- Composite provider — the app works signed out; upgrading claims the device data
- Sync: event-driven push, delta pull on open/foreground/manual, deferred
  in-progress workouts, dead-letter + retry, discard-local, hard erase
- In-app account deletion (edge function; cascades from `auth.users`)
- JSON export + import
- Units — lb/kg, mi/km, in/cm, exact round-trip; storage always metric

### Production plumbing
- **PWA** — service worker scoped to `/workout-tracker/`, `navigator.storage.persist()`
  called on every load so iOS doesn't evict IndexedDB under pressure
- **First-party error log** — signed-in crashes write a scrubbed record to
  Supabase (`client_errors`, INSERT-only RLS); no third-party SDK
- **Keep-alive** — daily `pg_cron` heartbeat against Supabase's free-tier idle timer
- **Privacy policy** — [`docs/privacy-policy.md`](docs/privacy-policy.md), linked
  from Sign-in and Account

## Not built yet

Deliberately deferred, in spec order:

- **iOS install-education card.** The service worker and
  `navigator.storage.persist()` are already wired; what remains is the in-app
  prompt teaching Safari users to "Add to Home Screen" so the persistence prompt
  actually fires.
- **Server-scheduled push** for the rest timer (spec §12.3). The in-app timer
  works; a notification with the app closed needs the Cloudflare Durable Object.
- **Remaining charts** (spec §9). 23 built, covering every color job so the
  system is proven; the rest are mostly the Body sub-tab and follow the same
  pattern.
- **Per-exercise charts on the library detail screen** — data and chart
  components both exist; wiring only.
- **Plate calculator**, **URL filter state**, **pinned charts**.
- **API-level keep-alive.** The `pg_cron` heartbeat is applied; a GH Actions
  HTTP cron would also cover the "API activity" interpretation of Supabase's
  idle policy (workflow snippet in DEPLOYING.md).
- **Weekly R2 backup** — manual JSON export covers it for now.
- **Progress photos** (spec §4.9).
- **E2E tests** (Playwright). Unit + repository + sync coverage is solid; the
  offline→force-quit→reconnect path is verified manually.

## Layout

```
src/
  domain/types.ts        Every entity. Mirrors the Postgres schema 1:1.
  lib/
    units.ts             All unit conversion. The only place it happens.
    dates.ts             All timezone-aware bucketing and formatting.
    metrics.ts           Volume, e1RM, working sets, region attribution. Pure.
    palette.ts           Region → color. Fixed assignment, never reordered.
    theme.ts             Theme presets, accent contrast enforcement.
    sessionTitle.ts      Auto titles: date + time of day + inferred split.
  db/
    database.ts          Dexie schema + the outbox queue.
    seed/                Base movements + biomarker definitions.
  auth/                  AuthProvider interface + local + Supabase impls.
  data/                  The single data-access boundary. Nothing else touches Dexie.
  sync/                  Outbox drain, delta pull, dead-letter, retry.
  features/
    workout/             The active workout screen — the product.
    insights/            Charts. Lazy-loaded so logging never pays for ECharts.
    coach/               AI coach: mock + Gemini providers, summary builder.
    auth/                Sign-in and account screens.
    library/             The exercise library.
    timer/               Rest timer state and all sound cues.
    history/  home/  profile/  templates/  onboarding/
  components/            Card, Button, SwipeableRow, DragList, FilterSheet, Toast.
  styles/
    tokens.css           Chart palette + status colors. NOT themeable.
    themes.css           The 7 presets. Surfaces, ink, accent.

test/                    Mirrors src/. 375 tests.
supabase/
  migrations/            16 SQL migrations; RLS policies + test suite.
  functions/             coach, delete-account.
```

Five conventions worth knowing before editing:

**Storage is always metric.** `weightKg`, `distanceM`, centimeters. Conversion
happens only in `lib/units.ts`, at the display boundary. Storing display units
would push conversion into every chart and PR comparison, where one miss
silently corrupts a year of analytics.

**Nothing imports Dexie except `data/`.** Screens call the repository (a barrel
over `data/outbox.ts`, `data/workouts.ts`, …). That's what keeps the sync layer
swappable.

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

The code should read on its own; reorganize or rename rather than annotate. Add
a comment ONLY when it earns its place — a non-obvious *why* (a workaround, an
invariant, a subtle ordering constraint), never a *what* the code already
states. Prefer one terse line over a block. No banners, no restating signatures,
no `// loop over exercises`. When editing, delete comments that have gone stale
or that narrate the obvious. The existing comments in this repo are the intended
density ceiling, not a target — most functions have none.

## Deploying

Lives at `hirshguha.com/workout-tracker`, from its own Vercel project that the
website proxies to. See **DEPLOYING.md** — including the service-worker scope
trap to avoid before the PWA ships.

## Where the design decisions live

`workout-app-spec.md` is the reference. Section numbers appear in comments
throughout the source where a non-obvious choice traces back to it — e.g.
`SetRow.tsx` cites §6.2 for why typing a value is what logs a set.
