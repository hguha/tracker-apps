# FitNote — Technical Specification

Living document. Last reconciled against the code **2026-08-09**.

This describes **what is built**, then **what is deliberately not built yet**. Where an earlier draft's plan was abandoned, the reason is recorded rather than deleted — the reasoning is the useful part.

---

## 1. What this is

A local-first, installable PWA for logging resistance training and cardio, for a handful of users. It works with no signal in a gym basement, syncs when it can, and turns the log into an analytics surface. Runs at $0 on free infrastructure.

**Three things must be excellent. Everything else is negotiable.**

1. **Logging a set is typing a number.** No confirm tap. Last session's numbers appear as placeholders; typing over one commits the set. This happens 30+ times per session.
2. **It never loses data.** Offline writes land in a durable local queue that survives force-quit, tab eviction, and a week without network.
3. **Last-time performance is always visible and instant.** Not behind a tap, not behind a modal, never dependent on the network.

### Actual stack

| Concern | Choice |
|---|---|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite |
| Local DB | Dexie (IndexedDB) — the authoritative read path |
| Reactivity | `dexie-react-hooks` `useLiveQuery` — screens re-render on write |
| Navigation | Hand-rolled view state in `src/app/App.tsx` |
| Session state | Zustand — rest timer only |
| Styling | Tailwind, hand-built components (no component library) |
| Charts | Apache ECharts, lazy-loaded as its own chunk |
| Dates | date-fns |
| Backend | Supabase (Postgres + RLS + Auth + Edge Functions) |
| AI | Google Gemini via a Supabase Edge Function |
| Hosting | Vercel, served at `hirshguha.com/workout-tracker` via proxy (see `DEPLOYING.md`) |
| Tests | Vitest (313 tests) |

**Deliberately not used**, despite earlier plans: TanStack Router and TanStack Query (navigation is simple enough that view state in one component is clearer, and Dexie's live queries removed the need for a server-state cache), shadcn/ui, react-hook-form, Zod.

**Cost:** $0. Optional domain ~$10/yr.

---

## 2. Verified constraints

Load-bearing on the design, and confirmed rather than assumed.

**Supabase free tier:** 500 MB database, 50,000 MAU, 5 GB egress, 500,000 Edge Function invocations. **Free projects pause after 1 week of inactivity; 2 active projects max.** Projected 5-year volume is ~35,000 sets per user — tens of MB, comfortably inside 500 MB.

**iOS web push** (per WebKit release notes, iOS 16.4+):
- Requires the app be **added to the Home Screen**. A normal Safari tab cannot subscribe, so the install is a feature gate.
- Permission must come from a **direct user gesture**.
- No Apple Developer membership needed — standards-based W3C Web Push over APNs.
- **No Notification Triggers API** in WebKit on any platform, so **any timed notification must be scheduled server-side**. This is why §10.3 exists.

**AI provider — the earlier plan was reversed.** An earlier draft disqualified Gemini on privacy grounds (free-tier input may be used for training and read by human reviewers) and specified Cloudflare Workers AI. **The shipped implementation uses Gemini** via `gemini-flash-latest`. That is acceptable *only* because of the §11 privacy contract: what leaves the device is a de-identified aggregate with no name, email, notes, or absolute dates. It remains a deliberate trade, and switching providers is one file (`supabase/functions/coach/index.ts`) plus a secret.

**Managed sync engines are not used.** Rocicorp Zero states "Zero does not support offline writes." ElectricSQL "does not do write-path sync." PowerSync solves it correctly, but with one writer per record, conflict resolution reduces to last-write-wins and the sync layer is a queue plus a delta pull. §4.6 keeps the exit cheap.

---

## 3. Scope boundaries

**Not** a social network — no feed, followers, or sharing. Not a nutrition tracker (biomarkers yes, macros no). No wearable integration. No billing, ads, or third-party analytics.

---

## 4. Architecture

```
┌──────────────────────────────────────────────┐
│  PWA — static assets on Vercel               │
│  React 19 + TS + Vite                        │
│  ├── Tailwind                                │
│  ├── Dexie / IndexedDB  ← the read path      │
│  ├── Outbox (durable mutation queue)         │
│  └── ECharts (lazy chunk)                    │
└───────────────┬──────────────────────────────┘
                │ HTTPS, JWT
┌───────────────▼──────────────────────────────┐
│  Supabase                                    │
│  Postgres + RLS · Auth · PostgREST ·         │
│  Edge Function: coach (Gemini)               │
└──────────────────────────────────────────────┘
```

### 4.1 Layers

| Layer | Rule |
|---|---|
| `src/domain/types.ts` | Mirrors the Postgres schema 1:1. Storage is always metric. |
| `src/db/` | Dexie schema, seeds, the outbox. |
| `src/data/repository.ts` | **The only module that touches Dexie.** Every mutation stamps sync columns and enqueues. |
| `src/sync/` | Engine + backend interface. Talks only to `SyncBackend`. |
| `src/features/` | Screens. Read via `useLiveQuery`, never import Dexie directly. |
| `src/lib/` | Pure, tested utilities: units, dates, metrics, progression, session titles, theme. |

### 4.2 Units

**Storage is always metric** — `weight_kg`, `distance_m`, lengths in cm. Conversion happens in exactly one place, `lib/units.ts`, at the display boundary. Storing units alongside values forces conversion into every chart, PR comparison, and volume sum, where one miss silently corrupts a year of analytics.

A `lb` user entering `135` stores `61.235 kg` and must see exactly `135` again. Sets carry `entered_unit` as a display hint.

### 4.3 Sync

**Read path:** IndexedDB is authoritative. Components never await the network.

**Write path:** every mutation is a local transaction plus an outbox row.

```ts
interface OutboxEntry {
  seq?: number            // auto-increment; defines apply order
  table: string
  op: 'insert' | 'update' | 'delete'
  rowId: string           // client-generated UUID
  payload: object         // the FULL row — see below
  clientRev: number
  queuedAt: number
  attempts: number
  lastError?: string
  nextAttemptAt?: number
  deferredForWorkoutId?: string
}
```

Rules, each guarding a failure that actually happened:

- **Client-generated UUIDs** → every insert is an upsert on a known PK, so replay is harmless.
- **The payload is the full row, not just changed fields.** The push is an upsert, which PostgREST issues as `INSERT ... ON CONFLICT DO UPDATE`, and Postgres evaluates the INSERT policy's `WITH CHECK` against the *proposed tuple*. A partial payload arrives with `user_id` absent, so RLS rejects it with "new row violates row-level security policy." An earlier design sent changed fields only (to avoid clobbering concurrent column edits) and **every update failed**.
- **Sequential drain ordered by `seq`.** Parallel drains reorder dependent writes (a `set` before its `workout_exercise`) and produce FK violations.
- **Failure classification.** 4xx other than 401/429 is *permanent* → dead-letter table, surfaced in Settings, stop retrying. Network errors and 5xx are *transient* → exponential backoff with jitter, capped at 5 minutes. 401 → pause for re-auth without dead-lettering. A poison entry silently blocking the queue is the classic hand-rolled-outbox failure.
- **An in-progress workout is not pushed at all.** Writes are tagged `deferredForWorkoutId` and released together by `finishWorkout`. Pushing a half-logged session made two devices disagree about whether a workout was active or finished. The drain **skips** deferred entries rather than stopping at them — they sit at the head of the queue for the whole session, so blocking would stall every unrelated write behind them.

**Triggers — push and pull are deliberately different:**

| | When |
|---|---|
| **Push** | A write lands in the outbox (observed via Dexie's `liveQuery`), or `online` fires |
| **Pull** | App open, foreground, or the manual button. **Never on a timer.** |

An earlier version reconciled every 30 seconds. A background *pull* writes to IndexedDB, every `useLiveQuery` re-runs, and the re-render lands mid-touch — on a phone the button takes its `:active` style but **the tap never registers**, and a form being filled in can have its row swapped underneath it. Pull is now user-initiated or lifecycle-driven only.

**Pull path:** `GET /rest/v1/{table}?updated_at=gt.{lastPulledAt}`, tombstones included, per-table high-water marks in `syncState`. Merge: the server row wins unless a local outbox entry for that row is still pending. A per-table failure is isolated — one table erroring must not abort the pull for the rest.

**Escape hatches**, both in Me → Data:
- **Retry failed** — requeues dead-lettered writes. Re-reads the *current* row rather than replaying the frozen payload (a stale payload re-sends the old `user_id` and fails forever), and requeues in dependency order so a parent precedes its children. Also runs `claimLocalData` first, repairing rows still owned by `local-user`.
- **Discard local changes & use the server's copy** — drops the outbox, resets cursors, re-pulls. For when a device has diverged and the server is the copy you trust.

### 4.4 Sync columns — on every user-owned table

| Column | Purpose |
|---|---|
| `created_at` | |
| `updated_at` | Trigger-maintained from the **server clock**, so a wrong phone clock can't poison ordering |
| `deleted_at` | Soft delete = tombstone. Hard deletes cannot be represented in pull-based sync |
| `client_rev` | Monotonic per-row counter; drives LWW comparison |

Every read path filters `deleted_at is null`.

**Exception — deliberate hard delete.** "Permanently erase all my training data" issues a real `DELETE` (`hardDeleteServerData`), because a tombstone leaves every row in Postgres, which is not what erasing your data means. Ordering is load-bearing: clear the queues *first* (a pending push would recreate what was just erased), delete children before parents, then reset the pull cursors. `profiles`, `muscles`, and `metric_definitions` are excluded — the profile is the account, and those hold shared system rows.

### 4.5 Row-Level Security

RLS on every table. Direct-ownership tables use `using (user_id = auth.uid())`. Tables without their own `user_id` walk the chain to the owning workout. Shared library tables (`exercises`, `muscles`, `metric_definitions`) are read-open (`user_id is null or user_id = auth.uid()`), write-own-only. System rows are seeded by migration under the service role, never through the API.

**Signup is open** as of migration `0010`. It was invite-only via an `allowed_emails` table plus an auth-hook trigger; that trigger is dropped.

A test suite asserts per table that user A cannot read or write user B's rows. **RLS failures are silent and total**, so this is not optional.

### 4.6 Keeping the exit cheap

All data access goes through `repository.ts`; no component imports the Supabase client. All server access goes through `SyncBackend`. Swapping hosts means reimplementing one interface. Same discipline for `AuthProvider` and `CoachProvider`.

---

## 5. Data model

Postgres, mirrored in `src/domain/types.ts`. Every user-owned table carries `user_id`, has RLS enabled, and carries the §4.4 sync columns. All `id` columns are generated client-side.

### 5.1 `profiles`

`id` (PK → `auth.users`), `display_name`, `unit_weight`, `unit_distance`, `unit_length`, `timezone` (IANA — required for correct day/week bucketing), `week_starts_on`, `weekly_workout_goal` (default 4), `default_rest_seconds` (default 60), `show_rpe` (default false), `show_avatar` (default false), `bodyweight_cache_kg`, `height_cm`, `training_goal` (free text, fed to the coach), `theme`, `color_scheme`, `accent_override`, `sound_enabled`, `auto_start_rest` (default false).

### 5.2 Muscle taxonomy

`region` is a fixed enum of **8**: `chest`, `back`, `shoulders`, `biceps`, `triceps`, `legs`, `core`, `cardio`.

Biceps and triceps are **separate regions**, not one "arms" — pull work and push work load them on different days, so folding them together hid the imbalance the split exists to surface. Elbow flexors and forearms roll up to `biceps`. Migration `0006` performed the split; the now-unused `arms` enum value remains because Postgres can't drop one.

`muscles`: `id`, `user_id` (nullable; `null` = system row), `name`, `region`, `is_archived`. **28 seeded.**

Two levels rather than one flat list, so a reverse dumbbell fly tags to **Rear Delt / shoulders** and lands in shoulder volume instead of polluting chest.

### 5.3 `exercises`

`id`, `user_id` (nullable), `name`, `primary_muscle_id`, `aliases`, `is_archived` (**never hard-delete** — history references it), `notes`, `default_rest_seconds`.

| Column | Values |
|---|---|
| `equipment` | `barbell`, `dumbbell`, `machine`, `cable`, `smith`, `bodyweight`, `kettlebell`, `band`, `other` |
| `movement_pattern` | `squat`, `hinge`, `lunge`, `horizontal_push`, `vertical_push`, `horizontal_pull`, `vertical_pull`, `carry`, `rotation`, `isolation`, `cardio` |
| `tracking_type` | **Drives the input UI.** `weight_reps`, `bodyweight_reps`, `weighted_bodyweight`, `assisted_bodyweight`, `reps_only`, `time`, `distance_time`, `weight_time` |
| `is_unilateral` | Enables per-side values |
| `bodyweight_factor` | Fraction of bodyweight moved. Pull-up 1.00, push-up 0.64, dip 0.95 |

**210 system exercises seeded**, including cardio modalities.

`secondaryMuscles` is an inline array locally (volume math needs it in one read) but Postgres normalizes it into an `exercise_secondary_muscles` join table. **There is no `secondary_muscles` column**, so the push strips it — sending it failed permanently and dead-lettered every custom-exercise write. **Known gap:** secondaries are not yet written to the join table, so a custom exercise synced to a second device arrives with its primary muscle only.

### 5.4 `workouts` / `workout_exercises` / `sets`

`workouts`: `id`, `user_id`, `started_at` (timestamptz, **not** a date — two-a-days must work), `ended_at` (nullable; `null` = in progress), `title`, `notes`, `perceived_exertion`, `template_id` (provenance → adherence charts), `bodyweight_kg`.

`workout_exercises`: `id`, `workout_id`, `exercise_id`, `position`, `superset_group` (same value = same superset), `rest_seconds`, `notes`.

`sets`: `id`, `workout_exercise_id`, `position`, `set_type`, `weight_kg`, `reps`, `reps_left`/`reps_right`, `duration_seconds`, `distance_m`, `rpe`, `rir`, `rest_taken_seconds` (**measured**, not target), `is_completed`, `completed_at`, `notes`, `entered_unit`.

`set_type` is collapsed to a single `normal` value. Warmup/dropset/AMRAP/backoff were removed as confusing and unused; the column is kept so stored rows and the sync schema stay stable.

RPE/RIR and measured rest are captured because they can't be backfilled, but the RPE UI is **off by default** behind `profiles.show_rpe`.

### 5.5 `templates` / `template_exercises`

`templates`: `id`, `user_id`, `name`, `description`, `folder` (one level), `last_used_at`, `times_used`, `is_archived`.

`template_exercises`: the above plus `target_sets`, `target_reps_low`, `target_reps_high`, `target_weight_kg`, `target_rpe`, `rest_seconds`, `notes`, and `progression` (JSONB).

Target **ranges**, all nullable — real programs read "3×8–10 @ RPE 8". Editing a template never mutates history.

`progression` holds a declarative double-progression rule: hold the weight until every working set reaches the top of the rep range at or under an RPE cap, then add an increment and reset to the bottom. Applied at instantiation by `lib/progression.ts` (pure, tested).

### 5.6 `personal_records`

Derived but materialized: `(user_id, exercise_id, record_type, value, achieved_at, set_id)`. `record_type`: `max_weight`, `max_reps_any_weight`, `max_est_1rm`, `max_volume_session`, `max_duration`, `max_distance`.

Recomputed **from scratch** on any set change, so a corrected weight can *remove* a record — an incremental "is this better?" comparison never can. Rebuildable server-side via an idempotent `rebuild_prs(user_id)`.

**`max_volume_session` is never announced as a PR.** It's a running session total, so set 2 necessarily beats set 1's total and set 3 beats set 2's — it fired a "New personal record" toast on essentially every set. It's still tracked and shown on the detail sheet.

`personal_records` is **not synced**: it's derived from sets, each device recomputes its own, and syncing derived rows is both redundant and a source of push/pull disagreement.

### 5.7 Body metrics

`metric_definitions`: `id`, `user_id` (nullable), `key`, `label`, `unit_type`, `category`, `higher_is_better` (**nullable** — `null` means no delta color, because bodyweight rising is neither good nor bad), `aggregation`, `precision`. **28 seeded.**

`metric_entries`: `(id, user_id, definition_id, measured_at, value, notes)`. Narrow/long, so adding a biomarker is a row insert with no migration.

---

## 6. The logging loop

This is the product.

### 6.1 The zero-tap set

**Logging a set is typing a number. There is no confirm step.**

Last session's values render as **placeholders** — gray, clearly not yet real. Typing over either field commits that set as performed in the same gesture. A set left as a bare placeholder is **ignored entirely**: not saved, not counted, not a PR candidate.

This replaced a design where inputs were pre-filled with real values confirmed by tapping a circle. The circle communicated nothing, and pre-filled real values meant a set the user never performed was already recorded as done.

**Placeholder precedence** (`lib/resolvePlaceholders.ts`, pure and tested):
1. A per-set override from a repeated workout or template
2. The same set index from the most recent session containing this exercise
3. **Carry-forward from earlier in the current card** — adding a 4th set to a 3-set history suggests the 3rd set's numbers, not blank fields
4. Nothing, for a first-ever performance

Rule 3 matters because "add set" is used mid-workout: a blank row forces manual entry at the moment the user is most tired.

**PR glow.** The moment a typed value would beat a stored record, the row is outlined in the status-good color. Computed locally — no round trip, so it appears in the same frame as the keystroke.

Two subtleties, both learned from bugs:
- The set that *holds* a record must still glow. Records are recomputed the instant a set is logged, so comparing a set against its own value (`180 > 180` is false) made the glow die the moment it saved. `previewRecords` takes the set's id and compares against the best of every **other** set.
- Simply *excluding* the self-held record is wrong — an empty comparison map trips the "nothing to beat yet" guard and suppresses the glow entirely. The runner-up must be **substituted**, not removed.

**`is_completed` is derived on write**, never toggled by the user: a set is complete when it has values. Planned-but-unperformed rows are deleted on finish.

### 6.2 Empty workouts are never saved

Finishing a session with no logged sets **discards it**. An empty workout is a false entry that breaks streaks, dilutes averages, and clutters history.

`purgeEmptyWorkouts()` exists as a repair for empty sessions that arrive anyway — pulled from an older build, or left by an interrupted session that never reached `finishWorkout`.

### 6.3 The rest timer is started by a button

Earlier builds started rest implicitly whenever a set became logged. That was unpredictable: correcting a typo, filling fields out of order, or logging a set long after performing it all produced a timer nobody asked for, with no visible trigger.

So the timer has **one explicit control** on the sticky bar. **Auto-start remains available, off by default**, as `profiles.auto_start_rest`.

Logging a set while rest is already running **does not restart it** — the timer measures the gap since the last set.

The timer's authoritative state is a **target timestamp**, not a decrementing counter, so backgrounding and returning shows the correct remaining time.

### 6.4 Cardio does not use sets

A run is one continuous effort, not three sets of running. For a `cardio` pattern the card renders a **single entry block** with time, distance, and derived live pace. "Add interval" is available but secondary; intervals are still `sets` rows underneath, so nothing downstream changes. No rest timer on cardio.

### 6.5 Other interactions

- **Drag to reorder, drag onto to superset.** Dropping between cards reorders; dropping onto another card supersets, with the drop target captioning the outcome before release.
- **Swipe** left on a set row deletes with undo; right copies the placeholder.
- **Session menu** — rename, change date and time, save as template, add a note, discard. This is also how a backdated workout is created; there is no separate "log a past workout" entry point.
- **Editing past workouts** opens the same component in edit mode. Everything is mutable. Editing a set re-runs PR detection, invalidates the `last_performance` cache, and uses the same outbox path, so it works offline.

### 6.6 Automatic session titles

A workout with no user title displays a derived one — `Jul 29 Evening · Push` — rather than "Workout", which carries no information in a history list. Part of day from `started_at` in the user's timezone; split inferred from regions actually trained by share of working sets. **Display-only**, never written to `workouts.title`, so it stays correct if sets are added later. `lib/sessionTitle.ts`, pure and tested.

### 6.7 Sound

One `AudioContext`, unlocked app-wide on first tap, and a single `playCue(name)` entry point. Cues: `set-logged` (very quiet, fires 30+ times a session), `pr`, `rest-warning`, `rest-complete`, `workout-complete`. Off switch in Settings.

---

## 7. Screens

Bottom tab bar: **Home · History · ( + ) · Insights · Me**. Sign-out lives in Account, never the tab bar — it must not be one mis-tap from a logging session.

| Screen | Contents |
|---|---|
| **Home** | Coach greeting, resume banner, "Log a workout" CTA, weekly goal ring, volume + Δ vs last week, streak, badges strip, sets-by-body-part bars, next-up, recent 3 |
| **Active workout** | §6 |
| **Start workout** | Empty / from template / repeat a past session (a list, not one "repeat last" button — the likely next workout is one of the last several) |
| **History** | List + calendar toggle, filters, pagination |
| **Insights** | 5 sub-tabs, one filter bar scoping the whole tab |
| **Exercise library** | Search, filter, full taxonomy, per-exercise history |
| **Templates** | List, folders, editor, preview-before-start |
| **Me** | Units, coaching (height + goal), rest default, weekly goal, RPE, avatar toggle, sound, theme, body metrics, export/import, sync status and controls, badges, account |
| **Coach** | §9 |
| **Badges** | Full grouped catalog |
| **Account** | Name, email, stats, connect-account, sign out, delete |

### 7.1 Home is one question

Home answers **"what should I do right now"**, then gets out of the way. Anything that merely duplicates another tab is removed.

Two things it learned:
- **Recent rows carry real information** — derived title, relative day and time, set count, volume, region dots. A history row the user can't identify is worse than no row.
- **The week figure carries a delta.** `12,400 lb · ↑8% vs last week` answers a question; `12,400 lb` alone doesn't. Omitted entirely when there's no prior week — an invented baseline misleads.

### 7.2 Gamification

Opt-in and deliberately unobtrusive.

- **Weekly goal ring** against `profiles.weekly_workout_goal`, turning green when met.
- **Week streaks** — consecutive weeks with ≥1 workout, honoring `week_starts_on`, with a DST-tolerant tiling. One shared `computeStreaks()` returns both current and best; Home and the Badges screen previously computed these separately and **disagreed**.
- **32 badges** across Milestones, Consistency, Strength, Volume, and Cardio. Home shows only badges *in play* (earned or started) — a wall of locked tiles is noise. `sanitizeStats()` guards against NaN from legacy rows (`NaN ?? 0` stays NaN).
- **Training avatar** — a tamagotchi-style figure whose 8 body parts grow and decay with recent work per region. **Off by default** (`profiles.show_avatar`) while it's a prototype.

---

## 8. Derived metrics

### 8.1 Definitions — single source of truth

| Metric | Definition |
|---|---|
| **Volume load** | `Σ (effective_weight_kg × reps)` over completed sets |
| **Effective weight** | `weight_reps` → `weight_kg`. `bodyweight_reps` → `bodyweight_kg × factor`. `weighted_bodyweight` → `+ weight_kg`. `assisted_bodyweight` → `− weight_kg`. Time/distance types contribute **no** volume load |
| **Working set** | Any logged, completed set. Replaces "hard set", which was jargon with a hidden `reps ≥ 5` rule — a set of 3 heavy singles is not "easy", and a term nobody can define on sight can't appear on a stat tile |
| **Estimated 1RM** | Epley `w × (1 + reps/30)`, **only for reps 1–12**. Above 12, return null rather than a fabricated number |
| **Per-muscle volume** | Primary muscle `1.0 ×`; each secondary `contribution ×`. Regions sum their muscles |
| **Cardio load** | `duration_seconds` and `distance_m` summed separately; **never** folded into volume load |
| **Streak** | Consecutive weeks with ≥1 workout, in the user's timezone, honoring `week_starts_on` |

All rounding goes through one utility — an earlier build displayed `250.833333333333337` for a 1RM.

### 8.2 Where aggregation runs

Everything runs **client-side against IndexedDB**. At 35,000 sets the data is already local and plain in-memory aggregation is milliseconds. The earlier plan for Postgres chart RPCs (and the TS↔SQL parity test that would have required) is **not built and not currently needed** — it becomes relevant only if all-time charts get slow or a correlation matrix lands.

`WorkoutSummary` carries `workingSetsByRegion` so Home buckets in memory rather than re-scanning per workout — that path was hundreds of serial IndexedDB reads on app open.

---

## 9. AI coach

**In scope:** critique balance and progression, produce a concrete plan as templates, answer freeform questions about the user's own history, and write the Home greeting.

**Out of scope:** medical or injury advice, nutrition prescription, anything phrased as certainty. Output is always a suggestion, always editable before becoming a template, never auto-applied.

### 9.1 The privacy contract

**Never send raw rows. Never send anything identifying.** `features/coach/summary.ts` builds a compact de-identified aggregate: per-exercise and per-week rollups, **no name, email, or notes**, and dates reduced to **week offsets** (0 = this week, −1 = last week) so nothing can be tied to a calendar. Exercise names are kept — they're the vocabulary the advice needs and identify no one.

It also carries bodyweight, height, and the free-text `training_goal`. The goal is the one free-text field that leaves the device; the Coach screen's **"Data sent"** disclosure renders the exact payload, because opt-in without visibility isn't meaningful consent.

This also shrinks the prompt from tens of thousands of tokens to a few thousand, which is what makes the free tier viable and the advice focused.

### 9.2 Providers

`CoachProvider` has two implementations, mirroring `SyncBackend`:

- **`mockProvider`** — deterministic, offline, no LLM. Real heuristics over the same summary. It exists so the whole interaction is usable before any key exists, and it's the fallback whenever the network or the function fails.
- **`geminiProvider`** — calls the `coach` Edge Function, which holds the API key in a secret. The key never reaches the client bundle.

The mock **must honor a stated goal**. It originally ignored the goal and replayed the user's history, so asking for a lower-body split returned an upper-body plan whenever the live provider was unreachable. It now parses the goal for split, emphasis, and duration and builds from library-matched movements.

Requests: `critique`, `plan(goal)`, `ask(question)` (which may itself return a plan), `encouragement`. Output is **structured JSON via a response schema**, so a plan deserializes straight into `templates` + `template_exercises` rather than being parsed from prose. Per-user rate limit in the function.

The Home greeting regenerates **only when the finished-workout count changes**, not on every app open, so it's a stable note rather than churn.

### 9.3 Deterministic progression ships first

`lib/progression.ts` covers most of the practical value with no LLM: a declarative double-progression rule applied at template instantiation.

---

## 10. Rest timer and notifications

Layered so each tier degrades into the next.

**Tier 1 — foreground (built).** In-app countdown from a target timestamp. Web Audio chime and `navigator.vibrate()` where supported. The `AudioContext` must be unlocked by a user gesture or the chime silently fails.

**Tier 2 — service worker (not built).** The SW holds the target timestamp and fires `showNotification()`. Reliable on Android and desktop; on iOS the SW may be suspended, in which case it no-ops.

**Tier 3 — server-scheduled push (not built).** Required because WebKit has no Notification Triggers API (§2). Supabase `pg_cron` has one-minute granularity, unusable for a 60-second timer, so this needs a Cloudflare Durable Object alarm scheduling to the second. **Cancellation is mandatory** — starting the next set, skipping rest, or finishing must cancel the alarm, or the user gets buzzed after leaving the gym.

Behind a `TimerService` interface so the tiers are swappable.

---

## 11. Auth, privacy, data ownership

### 11.1 Auth

Supabase Auth, **email magic link** primary — no passwords to store, reset, or leak. Signup is **open**.

`AuthProvider` is one interface with three implementations: `LocalAuthProvider` (device-only, no network), `SupabaseAuthProvider`, and `CompositeAuthProvider`, which runs both side by side so a user with a backend attached can still choose "this device only."

**A refresh failure while offline must not sign the user out or clear IndexedDB.** A gym with no signal must not log you out and hide your workout.

### 11.2 The device-only → account upgrade

A device-only account owns its rows under `local-user`. When that user signs in for real, their history must come with them — otherwise the account starts empty and every local row is stranded *and* silently rejected by RLS (`user_id` is `local-user`, not the caller's uid).

`claimLocalData(newUserId)` re-owns every local row to the new uid and re-enqueues it. `CompositeAuthProvider` detects a remote session arriving while a local one is active, runs the claim, then drops the local session — the one moment local yields to remote. Reachable in-app as **"Connect an account & sync"** without signing out first (signing out first would destroy the link).

### 11.3 The emailed code

The magic link is primary. The code field is the fallback for when the link opens in a different browser than the one that asked.

**Code length is a server setting** (`mailer_otp_length`, 6–10), not a constant. The UI hardcoded 6 while the project was configured for 8, so the field truncated the token and the submit button never enabled — typing a valid code did nothing, with no error, because nothing was ever submitted. `isSubmittableCode()` accepts a range and doesn't digit-filter (tokens aren't guaranteed numeric).

Custom email templates require custom SMTP; a Resend sender must be on a **verified domain** (an unverified subdomain is rejected and surfaces as a generic `unexpected_failure`).

### 11.4 Privacy

This app holds body weight, body-fat percentage, and years of behavioral data. Treat it as health data. RLS on every table, enforced by tests. No third-party analytics, no error-reporting SDK that captures request bodies, no ad tech. The coach sends only the §9.1 aggregate.

### 11.5 Export and import

Full versioned JSON export and import from Settings, entirely client-side (`data/backup.ts`). This is the backup mechanism, the migration path off this app, and what makes depending on a free tier acceptable — the data is never hostage to a pricing decision.

---

## 12. Charts

**21 of 41 built.** Sub-tabs: Overview · Strength · Volume & Balance · Consistency · Body.

Built: A-4, A-5, B-8, B-9, B-16, B-17, C-20, C-21, C-25, C-26, C-27, C-30, C-31, C-33, D-34, D-35, D-37, D-39, D-40, D-41, E-42, plus the Overview summary tiles. Each has a table-view twin and a per-chart empty state.

Charts are **config-driven** (`insights/catalog.tsx`): each entry declares which filters it responds to, so the filter bar adapts to the active tab instead of showing controls that silently do nothing.

**One filter bar per sub-tab**, scoping every chart in it: range, body part, exercise (searchable — what keeps it usable at 210 exercises). **Per-chart filters are forbidden** — two charts on one screen showing different slices quietly lie about the comparison.

### 12.1 Design rules that are not negotiable

- **Region → color never changes.** Colors follow the entity, not its rank, so filtering a region out must never repaint the survivors.
- **No chart uses two y-axes.** Two measures of different scale become two charts, small multiples, or both indexed to a common base. Dual axes make the reader see a correlation that's an artifact of arbitrary axis alignment.
- **Palette validated by a checker, never by eye.** Colorblind safety is computable. Scatter-type charts cap at **3 categorical series** — beyond slot 3 the palette fails CVD separation, which is why the weight×reps cloud uses a recency ramp.
- **Status colors are reserved** — never a series color, always paired with an icon or text label.
- Where `higher_is_better` is `null`, **no delta color is applied**. Inventing a valence is worse than omitting one.
- **Themes:** the UI theme is free to change; the **region palette is not themeable**. Its specific ordering is what passes the CVD gates, and "back is orange" has to keep being true. The accent never draws a chart mark — single-series charts use categorical slot 1.

---

## 13. What's built

313 tests passing. Everything below is in the codebase and working.

| Area | State |
|---|---|
| Logging loop — placeholders, zero-tap sets, PR glow, cardio blocks, supersets, swipe, session menu | ✅ |
| Editing past workouts, backdating, empty-workout discard | ✅ |
| Templates — folders, editor, preview, progression rules, save-from-4-places | ✅ |
| Repeat a past session, start screen as a list of recent sessions | ✅ |
| Exercise library screen with full taxonomy | ✅ |
| History list + calendar + filters + pagination | ✅ |
| 21 of 41 charts, config-driven, with table twins and empty states | ✅ |
| Body metrics (28 definitions) | ✅ |
| Rest timer tier 1, sound cues | ✅ |
| Themes + custom accent | ✅ |
| Home — goal ring, streaks, 32 badges, avatar (opt-in), coach greeting | ✅ |
| Auth — magic link, OTP fallback, device-only, composite provider, local→account upgrade | ✅ |
| Supabase backend — schema, RLS + test suite, 12 migrations, live project | ✅ |
| Sync — event-driven push, pull on open/foreground/manual, deferred in-progress workouts, dead-letter, retry, discard-local, hard erase | ✅ |
| AI coach — mock + Gemini, critique/plan/ask/encouragement, data disclosure | ✅ |
| Export / import JSON | ✅ |

## 14. What's not built

Ordered by value, with the reason it hasn't happened.

| Item | Why it's still open |
|---|---|
| **Secondary muscles in the sync join table** | Custom exercises sync, but their secondaries don't reach Postgres, so a second device sees primary-only. Smallest real correctness gap. |
| **PWA shell** — Workbox service worker, `navigator.storage.persist()`, iOS install education | Already works offline (IndexedDB is the read path); this is the installable wrapper and eviction protection. `persist()` matters most — without it iOS may evict IndexedDB under pressure. |
| **Remaining 20 charts** | Mostly the Body sub-tab, which needs logged biomarker history before it can draw anything. |
| **Per-exercise charts on the library detail screen** | Data and chart components both exist; wiring only. |
| **Pinned charts + URL filter state** | Needs `chart_prefs` and a router; deferred with routing itself. |
| **Plate calculator** | Nice-to-have; the quick-adjust chips cover most of it. |
| **Rest timer tiers 2 and 3** | Tier 3 needs a Cloudflare Durable Object. Only matters if the phone locks mid-rest. |
| **Bootstrap pull with progress bar** | The delta pull handles `since = 0` already; this is the determinate-progress UI. |
| **`delete-account` Edge Function + `keep_alive` cron** | Account deletion currently needs the service role. Keep-alive matters at 1 week idle (§2). |
| **Weekly R2 backup** | Manual JSON export covers it for now. |
| **Progress photos** | Needs a private bucket, signed URLs, and mandatory client-side compression — uncompressed phone photos exhaust the 1 GB free tier in ~15 months. |
| **E2E tests (Playwright)** | Unit and integration coverage is solid; the offline→force-quit→reconnect path is still manual. |
| **TS↔SQL metric parity test** | Only needed if server-side aggregation lands (§8.2). |

## 15. Deliberately abandoned

Recorded so they don't get "rediscovered".

| Idea | Why not |
|---|---|
| TanStack Router + TanStack Query | Navigation is a handful of views; Dexie live queries removed the need for a server-state cache. Adding a router now would only buy URL filter state. |
| shadcn/ui, react-hook-form, Zod | The hand-built components are small and the forms are simple. |
| Postgres chart RPCs + materialized views | Client-side aggregation over local data is milliseconds at this scale. A stale matview is worse than a slow query. |
| Warmup / dropset / AMRAP / backoff set types | Confusing and unused. The column stays for schema stability. |
| "Hard sets" | Undefinable jargon; now "working sets". |
| The confirm-circle set row | Communicated nothing, and recorded sets that were never performed. |
| Separate select-then-group superset mode | Replaced by drag-onto. |
| A separate "log a past workout" flow | The session menu's date control already does it. |
| Invite-only signup | Product decision; trigger dropped in `0010`, `allowed_emails` table dropped in `0012`. |
| `push_subscriptions` / `scheduled_notifications` tables | Created in `0001` for push, which was never built. Dropped in `0012` — an empty table no code reads misreads as a working feature. If push ships it needs a Durable Object anyway, so the schema gets designed alongside that. |
| Cloudflare Workers AI | Gemini shipped instead; see §2 for the trade. |
| Cloudflare Pages | Deployed on Vercel behind a proxy from `hirshguha.com`. |

---

## 16. Testing

- **Unit:** `lib/units.ts` (round-trip), `lib/dates.ts` (DST, week starts, timezones), `lib/metrics.ts` (every tracking type, bodyweight math, the 12-rep e1RM cutoff, cardio kept out of volume), `lib/progression.ts`, `lib/sessionTitle.ts`, `lib/theme.ts`.
- **Repository:** 78 tests — the logging loop, placeholder precedence, PR recomputation, outbox contents, the local→account claim, deletion semantics.
- **Sync:** against a mock backend — offline queueing, replay idempotency, permanent/transient/auth classification, dead-lettering, tombstones, deferred in-progress workouts, hard delete, discard-local.
- **Security:** per table, user A cannot read or write user B's rows (`supabase/tests/rls.test.sql`).
- **Not covered:** E2E (Playwright), and manual device passes for iOS install, audio unlock, and locked-screen push.

A note on style: several tests exist specifically because a bug shipped, and their comments say which. When one of those fails, read the comment before changing the assertion.

---

## 17. Cost

| Item | Plan | Cost |
|---|---|---|
| Static hosting | Vercel free | $0 |
| Postgres + Auth + Edge Functions | Supabase free | $0 |
| Transactional email | Resend free (3k/mo) | $0 |
| AI | Gemini free tier | $0 |
| Domain | already owned | — |
| **Total** | | **$0** |

Watch Supabase's free limits and 1-week pause policy, and the Gemini free-tier terms. Both are de-risked by §11.5 — the data is portable by construction, so a pricing change is an inconvenience, not a crisis.

An App Store build would add the **$99/year** Apple Developer fee, the one unavoidable cost. See §18.

---

## 18. Shipping to the App Store

FitNote is a PWA. Getting it onto the iOS App Store needs **no rewrite** — the front end runs unchanged in a native WebView. It needs a thin wrapper, an Apple Developer account, and a few review-guideline bars a pure PWA never faces.

**Capacitor** is the right wrapper: it loads the existing `dist/` in a WebView, bridges to native APIs, and produces a standard Xcode project.

Two realities: iOS has **no "upload a PWA" path** (Android's TWA has no equivalent here), and Apple **rejects "just a website" apps** under Guideline 4.2. FitNote clears that bar because it's offline-first with real device integration — but the native integrations below are what make the case to a reviewer, so they aren't optional polish.

Setup: `npx cap init`, set `webDir` to `dist`, and build with `BASE_PATH=/ npm run build` — **the app must be served from the bundle root inside the shell**, not the `/workout-tracker/` subpath (`vite.config.ts` already makes `BASE_PATH` overridable for exactly this).

What changes, all additive and all behind existing abstractions:
- **Native push (APNs) instead of Web Push** — one implementation swap behind the `TimerService`/notification interface.
- **Native file I/O for export/import** — same JSON, different boundary, behind one `isNativePlatform()` fork.
- **Haptics** on set-logged and PR — improves feel *and* strengthens the not-just-a-website case.
- **Drop the iOS "Add to Home Screen" card** when native.

Explicitly unchanged: data model, repository, sync, charts, metrics, every screen's layout.

Store bars: Apple Developer membership ($99/yr), icons and launch screen from `public/icon.svg`, the App Privacy questionnaire (easy — local-first, no third-party tracking, no data sold), a privacy policy URL, screenshots, and in-app account deletion (already built).

Budget it as **days, not weeks** — mostly the Apple account, assets, and one round of review feedback. Keep shipping the PWA in parallel; the wrapper is an extra distribution channel over the same build.
