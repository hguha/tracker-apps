# FitNote — Technical Specification

Draft 2026-07-29. Hand-off ready. (Renamed from "Workout Tracker" to **FitNote** 2026-08-07.)

---

## 1. Executive summary

A local-first, installable PWA for logging resistance training and cardio, for ~5 users. It works with no signal in a gym basement, syncs when it can, and turns the log into a deep analytics surface. Runs at $0 on free infrastructure.

**Three things must be excellent. Everything else is negotiable.**

1. **Logging a set is typing a number.** No confirm tap. Last session's numbers appear as placeholders; typing over one commits the set. This happens 30+ times per session.
2. **It never loses data.** Offline writes land in a durable local queue that survives force-quit, tab eviction, and a week without network.
3. **Last-time performance is always visible and instant.** Not behind a tap, not behind a modal, never dependent on the network.

**Functionality delivered:**

| Capability | Where |
|---|---|
| "Log a workout" → creator page; add exercises, log sets and reps, saved | §6 |
| Save any workout as a template — from the finish sheet, the session menu, or history | §7.1 |
| Copy any past workout as a new session | §7.2 |
| Add new exercises with muscle + equipment + pattern tagging, flowing into all charts | §4.3 |
| Browse the full exercise library any time, with all details and per-exercise history | §7.3 |
| Last time's numbers as placeholders; confirm or type over them | §6.2 |
| **PR glow** — a row lights up the instant its values would beat a record | §6.2 |
| Exercise detail sheet — notes, last 3 sessions, e1RM, records, per-exercise actions | §6.3 |
| **Edit any past workout** — add a missed set, fix a weight, insert a forgotten exercise | §6.6 |
| Backdate a session by changing its date from the session menu | §6.4 |
| Automatic session titles — `Jul 29 Evening · Push` | §6.7 |
| Drag to reorder; drag one exercise onto another to superset them | §6.4 |
| 41 charts, navigated by sub-tab with searchable body-part and exercise filters | §9, §9.0 |
| Login and multi-user with per-user data isolation | §11 |
| Phone, tablet, desktop from one codebase; installable, offline | §5 |
| Body weight, height, and ~27 other biomarkers, user-extensible | §4.9 |
| Rest timer, default 60s, per-exercise overrides, notification on expiry | §12 |
| Sound cues for logging, PRs, rest, and finishing | §6.8 |
| Preset color themes plus a custom accent | §10.8 |
| Dropsets, warmups, AMRAP, backoff sets, swipe gestures | §6.4 |
| Cardio tracking (time / distance / pace) alongside lifting | §4.3, §8.1 |
| AI coach reading history to build plans — long-term goal | §13 |

**Stack:** React 19 + TypeScript + Vite static SPA on Cloudflare Pages · Supabase (Postgres + RLS + Auth) · Dexie/IndexedDB local-first with an outbox queue · Apache ECharts · Cloudflare Workers for push scheduling, cron, and AI proxy.

**Cost:** $0. Optional domain ~$10/yr.

---

## 2. Verified constraints

These are confirmed, not assumed. They are load-bearing on the design.

**Supabase free tier:** 500 MB database, 50,000 MAU, 5 GB egress + 5 GB cached egress, 1 GB file storage (50 MB max upload), 500,000 Edge Function invocations, unlimited API requests. **Free projects are paused after 1 week of inactivity; limit of 2 active projects.** Mitigated in §5.4. Projected 5-year data volume per user is ~35,000 sets — a few tens of MB, comfortably inside 500 MB.

**iOS web push** (confirmed against WebKit's release notes for iOS 16.4):
- Requires the web app be **added to the Home Screen**; a normal Safari tab cannot subscribe. The install is a feature gate, not cosmetic.
- Permission must be requested **from a direct user gesture** (a tap on an explicit button). Calling it on page load is rejected.
- **No Apple Developer Program membership required.** Standards-based W3C Web Push over APNs.
- Notifications are delivered to the **service worker**, so they arrive with the app closed and the device locked — Lock Screen, Notification Center, paired Apple Watch, Badging API.
- **No Notification Triggers API** (`showTrigger` / `TimestampTrigger`) in WebKit on any platform. **Any timed notification must be scheduled server-side.** This is why §12.3 exists.
- Server-side: allow URLs from `*.push.apple.com`.

**Free AI providers:** Google's Gemini free tier is **disqualified**. Its pricing page marks free-tier content "Used to improve our products = Yes" for every model, its terms state human reviewers may read API input and output, and Google's own instruction is not to submit personal information to unpaid services — workout history plus body-fat percentage is personal health data. Groq's free tier caps at 8–12K tokens/minute, smaller than a single history prompt. Cerebras is a card-gated 30-day trial. GitHub Models caps input at 8,000 tokens and is documented as not for production. **Use Cloudflare Workers AI** (10,000 Neurons/day, permanent, hard-fails instead of billing). Its data/training policy is undocumented — confirm before enabling §13.

**Managed sync engines are not used.** Rocicorp Zero states verbatim "Zero does not support offline writes" and rejects writes after 60s disconnected. ElectricSQL states "Electric does not do write-path sync." PowerSync does solve this correctly, but at 5 users with exactly one writer per record, conflict resolution reduces to last-write-wins and the sync layer is a queue plus a delta pull. §5.6 keeps the exit cheap.

---

## 3. Scope boundaries

**Not** a social network — no feed, followers, or sharing. Not a nutrition tracker (biomarkers yes, macros no). No wearable integration. No billing, ads, or third-party analytics.

---

## 4. Data model

Postgres. Every user-owned table carries `user_id uuid not null references auth.users(id)`, has RLS enabled, and carries the sync columns in §4.11. All `id` columns are `uuid` **generated client-side** so offline inserts are idempotent upserts.

### 4.1 `profiles`

`id` (PK → `auth.users`), `display_name`, `unit_weight` (`lb`|`kg`), `unit_distance` (`mi`|`km`), `unit_length` (`in`|`cm`), `timezone` (IANA — required for correct day/week bucketing), `week_starts_on` (int), `default_rest_seconds` (default 60), `show_rpe` (boolean, **default false**), `chart_prefs` (jsonb — includes pinned charts, §9.0), `ai_opt_in` (boolean, default false), `bodyweight_cache_kg` (numeric — denormalized latest, for bodyweight-exercise volume math).

Appearance and feedback (§10.8, §6.8):

| Column | Purpose |
|---|---|
| `theme` | Named preset — `default`, `slate`, `forest`, `ocean`, `sunset`, `crimson`, `mono` |
| `color_scheme` | `system` \| `light` \| `dark` — independent of the preset |
| `accent_override` | Nullable hex. Overrides the preset's accent only; never chart series colors |
| `sound_enabled` | boolean, default true |
| `auto_start_rest` | boolean, **default false** — when on, logging a set starts rest (§6.4.2) |

### 4.2 Muscle taxonomy

`region` is a **fixed enum of 7** — matched to the 7 validated palette slots (§10.2):
`chest`, `back`, `shoulders`, `arms`, `legs`, `core`, `cardio`

`muscles` — seeded and user-extensible: `id`, `user_id` (**nullable**; `null` = system row visible to all), `name`, `region`, `is_archived`.

Seed ~30: chest → Upper/Mid/Lower Chest · back → Lats, Upper/Mid/Lower Traps, Rhomboids, Erectors, Teres · shoulders → Front/Side/Rear Delt · arms → Biceps, Triceps, Brachialis, Forearms · legs → Quads, Hamstrings, Glutes, Adductors, Abductors, Calves · core → Rectus Abdominis, Obliques, Transverse Abdominis · cardio → Cardiovascular.

Two levels, not one flat list, so a reverse dumbbell fly tags to **Rear Delt / shoulders** and lands in shoulder volume instead of polluting chest.

### 4.3 `exercises`

`id`, `user_id` (nullable; `null` = system library), `name`, `primary_muscle_id`, `is_archived` (**never hard-delete** — history references it), `notes` (cues, pin settings, seat height), `default_rest_seconds` (nullable, falls back to profile).

| Column | Values |
|---|---|
| `equipment` | `barbell`, `dumbbell`, `machine`, `cable`, `smith`, `bodyweight`, `kettlebell`, `band`, `other` |
| `movement_pattern` | `squat`, `hinge`, `lunge`, `horizontal_push`, `vertical_push`, `horizontal_pull`, `vertical_pull`, `carry`, `rotation`, `isolation`, `cardio` |
| `tracking_type` | **Drives the input UI.** `weight_reps`, `bodyweight_reps`, `weighted_bodyweight`, `assisted_bodyweight`, `reps_only`, `time`, `distance_time`, `weight_time` |
| `is_unilateral` | boolean — enables per-side values on sets |
| `bodyweight_factor` | numeric(3,2) — fraction of bodyweight moved. Pull-up 1.00, push-up 0.64, dip 0.95, inverted row 0.55 |
| `is_key_lift` | boolean — user-flagged; drives chart B-14 |

`exercise_secondary_muscles` — `(exercise_id, muscle_id, contribution numeric(3,2) default 0.50)`, composite PK. Enables partial credit: bench press is 1.0 Mid Chest, 0.5 Front Delt, 0.5 Triceps.

`exercise_aliases` — `(exercise_id, alias)`. "OHP", "military press", "standing press" all resolve to one row. Also the search index.

Ship ~200 system exercises including cardio modalities (treadmill, bike, row, elliptical, stair, swim, ruck). A user row with the same name as a system row shadows it in search.

### 4.4 `workouts`

`id`, `user_id`, `started_at` (timestamptz — **not** a date; two-a-days must work), `ended_at` (nullable; `null` = in progress), `title`, `notes`, `perceived_exertion` (int 1–10, nullable), `template_id` (nullable — provenance, enables adherence charts), `bodyweight_kg` (nullable, snapshotted), `location` (nullable).

Partial unique index enforces at most one `ended_at is null` per user — this is the resume-in-progress mechanism.

### 4.5 `workout_exercises`

`id`, `workout_id`, `exercise_id`, `position` (order within session), `superset_group` (nullable int — same value = same superset), `rest_seconds` (nullable override), `notes`.

### 4.6 `sets`

`id`, `workout_exercise_id`, `position`, `is_completed` (false = planned, not done), `completed_at` (nullable), `notes`.

| Column | Type | Purpose |
|---|---|---|
| `set_type` | enum | `normal`, `warmup`, `dropset`, `failure`, `amrap`, `backoff` |
| `weight_kg` | numeric(7,2) | |
| `reps` | int | |
| `reps_left` / `reps_right` | int | Unilateral only |
| `duration_seconds` | int | Planks, carries, cardio |
| `distance_m` | numeric(9,2) | Cardio |
| `rpe` | numeric(3,1) | 6.0–10.0 in 0.5 steps. Nullable, UI hidden by default |
| `rir` | int | Reps in reserve — alternative to RPE, same treatment |
| `rest_taken_seconds` | int | **Measured**, not target. Powers D-36 |

All numeric columns are real numeric types. RPE/RIR and measured rest are captured because they cannot be backfilled — but the RPE UI is **off by default** behind `profiles.show_rpe`, so the schema is ready without the logging surface paying for it.

### 4.7 `templates` / `template_exercises`

`templates`: `id`, `user_id`, `name`, `description`, `folder` (one level, e.g. "PPL 6-day"), `created_at`, `last_used_at`, `times_used`, `is_archived`.

`template_exercises`: `id`, `template_id`, `exercise_id`, `position`, `superset_group`, `target_sets`, `target_reps_low`, `target_reps_high`, `target_weight_kg`, `target_rpe`, `rest_seconds`, `notes`.

Target **ranges**, all nullable — real programs read "3×8–10 @ RPE 8", and a template can also be as loose as a bare exercise list. Editing a template never mutates history; `workouts` keeps its own copy of what was planned.

### 4.8 `personal_records`

Derived but materialized. `(user_id, exercise_id, record_type, value, achieved_at, set_id)`.
`record_type`: `max_weight`, `max_reps_any_weight`, `max_est_1rm`, `max_volume_session`, `max_reps_at_weight`, `max_duration`, `max_distance`.

Maintained by a trigger on `sets`, and fully rebuildable via an idempotent `rebuild_prs(user_id)` function so a sync hiccup can never leave PRs permanently wrong.

### 4.9 Body metrics

`metric_definitions` — `id`, `user_id` (nullable), `key`, `label`, `unit_type` (`mass`|`length`|`percent`|`count`|`duration`|`ratio`|`arbitrary`), `category` (`body_composition`|`circumference`|`vitals`|`performance`|`subjective`|`custom`), `higher_is_better` (**nullable** — `null` means no delta color, because bodyweight rising is neither good nor bad), `aggregation` (`last`|`mean`|`min`|`max`), `precision`.

Seed 27: bodyweight, height, body_fat_pct, lean_mass, resting_hr, hrv, blood_pressure_sys/dia, sleep_hours, sleep_quality, vo2max, waist, hips, chest, neck, shoulders, bicep_l/r, forearm_l/r, thigh_l/r, calf_l/r, mood, soreness, stress.

`metric_entries` — `(id, user_id, definition_id, measured_at, value numeric, notes)`. Narrow/long, so adding a biomarker is a row insert with no migration. Charts pivot in SQL.

`progress_photos` — `(id, user_id, taken_at, storage_path, pose enum(front|side|back), notes)`. **Phase 8.** Private Supabase Storage bucket, short-lived signed URLs, RLS-scoped, never synced to IndexedDB.

### 4.10 Push and scheduling

`push_subscriptions` — `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `user_agent`, `platform`, `created_at`, `last_success_at`, `consecutive_failures`. Prune at 5 consecutive failures; a 410 Gone means the subscription is dead.

`scheduled_notifications` — `id`, `user_id`, `fire_at`, `kind` (`rest_timer`|`reminder`), `payload` jsonb, `sent_at` (nullable), `cancelled_at` (nullable). Indexed `(fire_at) where sent_at is null`.

### 4.11 Sync columns — on every user-owned table

| Column | Purpose |
|---|---|
| `created_at` | |
| `updated_at` | Trigger-maintained from the **server clock**, so a phone with a wrong clock can't poison ordering |
| `deleted_at` | Soft delete = tombstone. Hard deletes cannot be represented in pull-based sync |
| `client_rev` | Monotonic per-row counter, bumped locally per edit; drives LWW comparison |

Every read path filters `deleted_at is null`. Tombstones purged server-side after 90 days.

### 4.12 Units

**Storage is always metric** — `weight_kg`, `distance_m`, lengths in cm. Conversion happens in exactly one place, at the display boundary (§5.7 `lib/units.ts`). Storing units alongside values forces conversion logic into every chart, PR comparison, and volume sum, where one miss silently corrupts a year of analytics.

Plate-math rounding: a `lb` user entering `135` stores `61.235 kg`, and display must return exactly `135`. Sets carry `entered_unit` as a display hint, and display conversions round to the nearest representable increment in the target unit (2.5 lb / 1.25 kg default, per-exercise configurable for micro-plates).

### 4.13 Row-Level Security

RLS enabled on every table. Direct-ownership tables use `using (user_id = auth.uid())`. Tables without their own `user_id` walk the chain:

```sql
alter table sets enable row level security;
create policy "own sets" on sets for all using (
  exists (
    select 1 from workout_exercises we
    join workouts w on w.id = we.workout_id
    where we.id = sets.workout_exercise_id and w.user_id = auth.uid()
  )
);
```

Shared library tables (`exercises`, `muscles`, `metric_definitions`) are read-open, write-closed:

```sql
create policy "read system + own" on exercises for select
  using (user_id is null or user_id = auth.uid());
create policy "write own only" on exercises for insert
  with check (user_id = auth.uid());
create policy "update own only" on exercises for update
  using (user_id = auth.uid());
```

System rows are seeded by migration under the service role, never through the API.

**Signup is invite-only:** an `allowed_emails(email text primary key)` table plus an auth-hook trigger rejects anyone not listed. Managed by direct SQL.

**Required:** a test suite asserting, per table, that user A cannot read or write user B's rows. RLS failures are silent and total.

### 4.14 Indexes

```sql
create index on workouts (user_id, started_at desc) where deleted_at is null;
create index on workout_exercises (workout_id, position);
create index on workout_exercises (exercise_id);
create index on sets (workout_exercise_id, position);
create index on metric_entries (user_id, definition_id, measured_at desc);
create index on scheduled_notifications (fire_at) where sent_at is null;
create unique index one_active_workout on workouts (user_id) where ended_at is null;
```

---

## 5. Architecture

```
┌──────────────────────────────────────────────────┐
│  PWA — static assets on Cloudflare Pages         │
│  React 19 + TS + Vite                            │
│  ├── Tailwind v4 + shadcn/ui                     │
│  ├── TanStack Router + TanStack Query            │
│  ├── Dexie / IndexedDB  ← the read path          │
│  ├── Outbox (durable mutation queue)             │
│  └── Service Worker (Workbox)                    │
└───────────────┬──────────────────────────────────┘
                │ HTTPS, JWT
┌───────────────▼──────────────────────────────────┐
│  Supabase                                        │
│  Postgres + RLS (source of truth) · Auth ·       │
│  PostgREST · chart RPCs · Edge Functions ·       │
│  Storage (photos, Phase 8)                       │
└───────────────┬──────────────────────────────────┘
┌───────────────▼──────────────────────────────────┐
│  Cloudflare Workers (free)                       │
│  Durable Object alarms → precise rest push ·     │
│  cron keep-alive · cron backup · AI proxy        │
└──────────────────────────────────────────────────┘
```

### 5.1 Frontend stack

| Concern | Choice |
|---|---|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite 6 |
| Routing | TanStack Router — chart filter state lives in typed search params |
| Server state | TanStack Query + Dexie persister |
| Local DB | Dexie (IndexedDB) |
| Session state | Zustand — active-workout draft and rest timer, deliberately separate from server state |
| Styling | Tailwind v4 |
| Components | shadcn/ui (Radix primitives) — copy-in, accessible by default |
| Charts | Apache ECharts, tree-shaken (§10.7) |
| Forms | react-hook-form + Zod — one schema per entity, shared with the repo layer to validate synced payloads |
| Dates | date-fns + date-fns-tz |
| PWA | vite-plugin-pwa (Workbox) |
| Tests | Vitest + Playwright |

**Static SPA, not Next.js.** Every screen is behind auth so there is nothing to server-render, and first paint should come from IndexedDB, not a server. Cloudflare Pages has unmetered requests on the free plan and no non-commercial-use ambiguity.

### 5.2 Routes

Bottom tab bar: 4 tabs plus a center action. **Sign-out lives in Settings, never the tab bar** — it must not be one mis-tap from a logging session.

```
Home   History   ( + )   Insights   Me
```

| Route | Purpose |
|---|---|
| `/` | Resume-in-progress banner, "Log a workout" CTA, this-week KPI row, weekly working-sets-per-region bars, next-up suggestion |
| `/log/new` | Template picker → empty / from template / repeat last |
| `/log/:id` | **Active workout** (§6) |
| `/history` | Reverse-chronological list + calendar toggle; search and filter by exercise |
| `/history/:id` | Session detail, **editable** (§6.6); save as template; repeat |
| `/insights` | Chart tab, 5 sub-tabs (§9) |
| `/insights/exercise/:id` | Per-exercise deep dive |
| `/exercises` | Library: search, filter by muscle/equipment/pattern, add new |
| `/exercises/:id` | History, PRs, notes, last-time, per-exercise charts |
| `/templates` | List, folders, editor |
| `/body` | Metric entry, trends, photos (Phase 8) |
| `/me` | Profile, units, rest defaults, RPE toggle, volume targets, theme, export/import, notification permission, AI opt-in, sign out |

### 5.2.1 The Home screen

Home has one job: **answer "what should I do right now"**, then get out of the way. Everything on it earns its place by serving that, and anything that is merely a duplicate of another tab is removed.

Ordered by urgency:

| Block | Content | Shown when |
|---|---|---|
| **Resume** | In-progress session, elapsed time, sets so far | A session is unfinished |
| **Greeting** | `Good evening, Harsh` — part of day plus display name | Always |
| **Start** | Primary CTA | No session in progress |
| **This week** | Hero volume figure with a Δ vs last week, plus workouts / sets / streak | Any history |
| **Next up** | Least-recently-trained region, days since, and a one-tap start from the template that covers it | ≥1 week of history |
| **Recent** | Last 3 sessions — derived title, relative day, sets, volume, region dots | Any history |
| **Coach** | AI suggestion for today (§13) | Phase 7, opt-in |

Two changes from the first build:

- **Recent rows carry real information.** They previously read "Workout" with a date. Now: derived title (§6.7), relative day and time, set count, volume, and region dots. A history row the user cannot identify is worse than no row.
- **The week summary gains a delta.** A number with no comparison is not an insight. `12,400 lb · ↑8% vs last week` answers a question; `12,400 lb` alone does not. The delta uses the status palette and is omitted entirely when there is no prior week to compare against — an invented baseline would mislead.

### 5.3 UI principles

- **Thumb-reachable.** Primary actions in the bottom third; the set-confirm button is the largest touch target on screen.
- **No modal for anything done 30 times a session.** Inline editing on the set row only.
- **Numeric inputs** use `inputMode="decimal"` with steppers and `+2.5 / +5 / +10` quick-adjust chips.
- **Optimistic always.** Every tap updates the UI in the same frame. No spinners in the logging loop.
- One-handed operation must cover the entire set-logging loop.

### 5.4 Free-tier survival

Supabase pauses free projects after **1 week** of inactivity (§2). Two mitigations:

1. A **Cloudflare Worker cron** hits a trivial `select 1` RPC every 3 days.
2. The client treats a paused backend as an offline condition — fully functional against IndexedDB, one unobtrusive "sync paused" chip, writes keep queueing.

Plus a **weekly automated backup**: a Worker cron calls an Edge Function that dumps each user's rows to JSON into Cloudflare R2. Same code path as §11.3 export. Free tiers change and companies pivot; years of irreplaceable personal data needs a backup that doesn't depend on remembering to make one.

### 5.5 Offline sync

**Read path:** IndexedDB is authoritative for the UI. Components never await the network. TanStack Query resolves from Dexie and revalidates in the background.

**Write path:** every mutation is a local transaction plus an outbox row.

```ts
type OutboxEntry = {
  seq: number          // auto-increment; defines apply order
  table: string
  op: 'insert' | 'update' | 'delete'
  rowId: string        // client-generated UUID
  payload: Record<string, unknown>   // changed fields only
  clientRev: number
  queuedAt: number
  attempts: number
  lastError?: string
}
```

Rules:

- **Client-generated UUIDs** → every insert is an upsert on a known PK, so replay is harmless.
- **Field-level updates** → two edits to different columns of one row don't clobber each other.
- **Sequential drain ordered by `seq`**, one entry at a time. Parallel drains reorder dependent writes (a `set` before its `workout_exercise`) and produce FK violations.
- **Failure classification.** 4xx other than 401/429 is *permanent* → move to a dead-letter table, surface in Settings, stop retrying. Network errors and 5xx are *transient* → exponential backoff with jitter, capped at 5 minutes. A poison entry silently blocking the queue is the classic hand-rolled-outbox failure.
- **Drain triggers:** app foreground, `online` event, successful auth refresh, 30s interval while online, service-worker `sync` where supported.

**Pull path:** `GET /rest/v1/{table}?updated_at=gt.{lastPulledAt}`, tombstones included. Per-table high-water marks in a local `sync_state` table. Merge: server row wins unless a local outbox entry for that row is still pending, in which case local optimistic state holds until its write lands.

**Bootstrap:** first login pulls everything with a determinate progress bar; later launches pull deltas.

**Durability:** call `navigator.storage.persist()` after the first logged workout — without it iOS may evict IndexedDB under storage pressure. Surface `navigator.storage.estimate()` and pending-queue depth in Settings.

### 5.6 Keeping the exit cheap

All data access goes through one repository module; no component imports the Supabase client directly. Swapping to PowerSync or another host means reimplementing one interface.

```ts
interface WorkoutRepo {
  getWorkout(id: string): Promise<Workout | null>
  listWorkouts(range: DateRange): Promise<WorkoutSummary[]>
  upsertSet(s: SetInput): Promise<void>
  getLastPerformance(exerciseId: string): Promise<LastPerformance | null>
  // …
}
```

Same discipline for the timer layer (§12.4).

### 5.7 Cross-cutting utilities

Three modules, each with mandatory tests:

- **`lib/units.ts`** — all conversion and plate rounding. Property-tested: `toDisplay(toCanonical(x, u), u) === x` for every plate-representable `x`.
- **`lib/dates.ts`** — all timezone-aware bucketing (day/week/month in the user's zone), formatting, range math. Tested against October, DST boundaries, week-start settings.
- **`lib/metrics.ts`** — volume load, e1RM, working-set counting, per-muscle attribution. Pure functions, and **paired with SQL equivalents that must agree on a fixture** (§8.3).

### 5.8 PWA

- `manifest.webmanifest`: `display: standalone`, maskable 192/512 icons, `theme_color` per scheme, shortcuts for "Start workout" and "Log weight".
- Workbox: precache the shell with a **versioned** manifest (Vite content hashes); `NetworkFirst` for API GETs with IndexedDB fallback; **never** cache POST/PATCH — those go through the outbox.
- Update flow: non-blocking "Update available — reload" chip. **Never auto-reload mid-session** — it would discard an in-progress set.
- **iOS install education:** a dismissible one-time card on iOS Safari when not in standalone mode, explaining Share → Add to Home Screen. Push requires this install (§2), so it gates a feature.
- Wake Lock during an active workout (opt-in) so the screen stays alive between sets.

---

## 6. Active workout screen

This is the product.

### 6.1 Layout

```
┌───────────────────────────────────────────┐
│ ← Pull A            0:42:15      ⋯        │
├───────────────────────────────────────────┤
│ ┌───────────────────────────────────────┐ │
│ │ Lat Pulldown              ⋯           │ │
│ │ Last: Jul 21 · 3×8 @ 65kg · e1RM 81   │ │ ← always visible
│ │───────────────────────────────────────│ │
│ │  #   prev      kg      reps           │ │
│ │  1   65×8    [ 65 ]  [  8 ]     ✓     │ │
│ │  2   65×8    [ 65 ]  [  8 ]     ✓     │ │
│ │  3   65×7    [ 65 ]  [  7 ]     ○     │ │ ← next, PRE-FILLED
│ │  + Add set                            │ │
│ └───────────────────────────────────────┘ │
│ ┌───────────────────────────────────────┐ │
│ │ Seated Cable Row            ⋯         │ │
│ │ Last: Jul 21 · 3×10 @ 50kg  …collapsed│ │
│ └───────────────────────────────────────┘ │
│  + Add exercise                           │
├───────────────────────────────────────────┤
│   Rest  0:47 ──────────────  +30s  Skip   │ ← sticky while running
├───────────────────────────────────────────┤
│            Finish workout                 │
└───────────────────────────────────────────┘
```

### 6.2 The zero-tap set

**Logging a set is typing a number. There is no confirm step.**

Last session's values render as **placeholders** — gray, clearly not yet real. Typing over either field commits that set as performed, in the same gesture, and starts the rest timer. A set left as a bare placeholder is **ignored entirely**: not saved, not counted in volume, not a candidate for a PR.

This replaces an earlier design where inputs were pre-filled with real values confirmed by tapping a circle. The circle communicated nothing — it read as decorative — and pre-filled real values meant a set the user never performed was already recorded as done.

```
SET  PREV      LB     REPS
 1   135×8   [ 135 ] [  8 ]     ← typed: logged, timer running
 2   135×8     135      8       ← gray placeholder: ignored
 3   135×7     135      7       ← gray placeholder: ignored
```

**Confirming last week's numbers is one tap.** A `Same` button on the row copies the placeholder into every field at once, for the common case of matching last time exactly.

Placeholder precedence:
1. Template target, if the session came from one
2. Same set index from the most recent session containing this exercise
3. **The last set of the current session**, for a set added beyond what history covers — adding a 4th set to a 3-set history should suggest the 3rd set's numbers, not blank fields
4. Last set of the previous session, if neither applies
5. Nothing, for a first-ever performance

Rule 3 matters because "add set" is used mid-workout: a blank row there forces manual entry at the exact moment the user is most tired.

**PR glow.** The moment a typed value would beat a stored record, the row is outlined in the status-good color with a `PR` chip. Computed locally from the `personal_records` table — no round trip, so it appears in the same frame as the keystroke. A first-ever performance never glows; there was nothing to beat.

**`is_completed` semantics.** The column stays in the schema, because a template instantiates planned sets that have not happened yet. The rule is: a set is complete when it has values, so `is_completed` is derived on write rather than toggled by the user. Planned-but-unperformed rows are deleted on finish rather than persisted as empty.

### 6.3 Last-time panel and the exercise detail sheet

Card header, always rendered without interaction: `Last: {relative date} · {sets}×{reps} @ {weight} · e1RM {n}`.

The card's **`⋯` opens an exercise detail sheet** — previously a dead control. Five sections:

| Section | Contents |
|---|---|
| **Notes** | Free text on this exercise, persisted to `exercises.notes`. Seat height, pin setting, cues. Edited inline. |
| **This session** | Sets logged so far, volume, best e1RM. |
| **Last 3 sessions** | Set-by-set table with per-set deltas vs the session before. |
| **Records** | Every `record_type` held for this exercise, with the date each was set. |
| **Actions** | Rest-timer override, mark as key lift, replace exercise, remove from session. |

**Implementation:** a denormalized Dexie table `last_performance`, keyed by `exercise_id`, holding the last 3 sessions. Reads are one indexed lookup — sub-millisecond, offline, no scan over history.

### 6.4 Interactions

- **Drag to reorder, drag to superset.** Long-press an exercise card to lift it, then drag. Dropping **between** cards reorders. Dropping **onto** another card supersets the two — the drop target highlights and captions "Superset with Bench Press" so the outcome is stated before release. There is no separate superset mode; the old select-then-group flow is removed.
- **Dropsets** — from the set row's long-press menu. Dropset rows render indented under their parent set with no rest timer between them, since the point is no rest.
- **Swipe gestures** — swipe-left on a set row deletes with an undo toast; swipe-right copies the placeholder into the row (confirm last time's numbers). Swipe-left on an exercise card removes it, undoable. Long-press a set row for the set-type menu.
- **Warmups** render de-emphasized and are excluded from volume and PRs.
- **RPE** — hidden unless `profiles.show_rpe`. When on, a third field appears on the set row.
- **Plate calculator** — tap a weight value for a sheet showing plates per side.
- **Session menu** (`⋯`, top right) — rename, **change date and time**, save as template, add a session note, discard. This is also how a backdated workout is created: start a normal workout and change its date. There is no separate "log a past workout" entry point.
- **Finish** — summary sheet: duration, total volume, sets, new PRs, region split, save as template.
- **Crash safety** — the draft lives in Zustand with IndexedDB persistence, written on every mutation.

### 6.4.1 Empty workouts are never saved

Finishing a session with no logged sets **discards it** rather than writing an empty row. An empty workout is not a record of anything; it is a false entry that breaks streaks, dilutes averages, and clutters history.

The discard is explicit, not silent — the finish sheet for an empty session offers "Discard" as the primary action and explains why. Combined with the §6.2 rule that untouched placeholder rows are dropped on finish, this means a session opened by accident leaves no trace.

### 6.4.2 The rest timer is started by a button

Earlier builds started rest implicitly whenever a set transitioned to logged. That was unpredictable in practice — correcting a typo, filling fields out of order, or logging a set long after performing it all produced a timer the user didn't ask for, and it was never obvious what had triggered one.

So the timer has **one explicit control**: a rest button on the sticky bar.

| State | Bar shows |
|---|---|
| Idle | `Start rest — 1:30` (the resolved default for the current exercise) with a `Start` button |
| Running | Countdown, progress, `+30s`, `Skip` |
| Expired | `Rest over` in the good color until dismissed or a new set is logged |

**Auto-start remains available but is off by default**, as `profiles.auto_start_rest`. When on, logging a set starts rest — the previous behavior, now opt-in and labeled, so a user who liked it can have it and nobody gets it by surprise.

Two rules hold in both modes:
- A **dropset** never starts rest. The point of a dropset is not resting.
- Logging a set while rest is already running **does not restart it**. The timer measures the gap since the last set, and restarting it mid-rest would misreport that gap in D-36.

### 6.5.1 Cardio does not use sets

A run is one continuous effort, not three sets of running. Rendering cardio as a numbered set list borrows a structure from lifting that does not fit it.

So for a `cardio` movement pattern the card renders a **single entry block** rather than a set table:

```
┌───────────────────────────────────────────┐
│ ● Treadmill Run                     ⋯     │
│ Last: Jul 28 · 3.10 mi · 27:30 · 8:52/mi  │
│───────────────────────────────────────────│
│  Time            Distance                 │
│  [ 27:30 ]       [ 3.10 ] mi              │
│                                           │
│  Pace 8:52 / mi                    Same   │
│                                           │
│  + Add interval                           │
└───────────────────────────────────────────┘
```

- **One block by default.** Pace is derived and shown live as the fields are filled, never entered.
- **"Add interval"** is available but secondary, for genuine interval work. Intervals are still `sets` rows underneath — the schema does not change — so nothing downstream needs to know the difference.
- **No rest timer** on cardio entries; rest between intervals is part of the workout, not a prompt.
- The last-time line reads distance, time, and pace rather than sets × reps.

### 6.5 Cardio input

When `tracking_type` is `time` or `distance_time`, the set row swaps weight/reps for duration and distance, and shows derived pace. `weight_time` (loaded carries) shows weight and duration. The input surface is driven entirely off `tracking_type` — one component, switched.

### 6.6 Editing past workouts

`/history/:id` opens the same component as `/log/:id` in an edit mode. Everything is mutable: change a weight or rep count, add a set you forgot to log, insert an exercise you did but never entered, delete a set logged twice, adjust `started_at`, retitle, edit notes.

Consequences that must be handled:
- Editing a set **re-runs PR detection** for that exercise. A corrected weight can create or invalidate a PR, so recomputation is from scratch rather than an incremental "is this better?" comparison, which could never *remove* a record.
- Edits invalidate the `last_performance` cache for affected exercises.
- Chart caches for the affected date range are invalidated.
- Rest timer and session timer are inert in edit mode.
- Same outbox path as live logging, so past-workout edits work offline too.

Backdating is not a separate flow: start a normal workout and change its date from the session menu (§6.4).

### 6.7 Automatic session titles

A workout with no user-supplied title displays a derived one rather than the literal string "Workout", which carries no information in a history list.

Format: `{date} {part of day} · {split}` — e.g. `Jul 29 Evening · Push`.

- **Part of day** from `started_at` in the user's timezone: Morning < 12:00, Afternoon < 17:00, else Evening.
- **Split** inferred from the regions actually trained, by share of working sets:

| Condition | Label |
|---|---|
| One region ≥ 70% of sets | that region's name — `Legs`, `Back` |
| Chest + shoulders + arms ≥ 70%, and push patterns dominate | `Push` |
| Back + arms ≥ 70%, and pull patterns dominate | `Pull` |
| Legs ≥ 70% | `Legs` |
| Upper-body regions ≥ 70% | `Upper` |
| Cardio ≥ 70% | `Cardio` |
| Otherwise, ≥ 3 regions present | `Full Body` |
| No sets logged | omit the split segment |

The derived title is **display-only** — never written to `workouts.title`, so it stays correct if sets are added later, and a user-typed title always wins. Implemented in `lib/sessionTitle.ts`, pure and unit-tested.

### 6.8 Sound design

Audio is a real part of the feel, and all of it degrades silently where unsupported. One `AudioContext`, unlocked on the session's first tap (§12.1), and a single `playCue(name)` entry point so cues are consistent and mutable from one place. Off switch in Settings; respects the device silent switch by virtue of using Web Audio.

| Cue | When | Character |
|---|---|---|
| `set-logged` | A set is committed | Very short, very quiet click. Fires 30+ times a session, so it must sit under conversation volume. |
| `pr` | A logged set beats a record | Rising three-note flourish. Rare, so it can be prominent. |
| `rest-warning` | 10s left on the rest timer | Single soft tick. |
| `rest-complete` | Rest expires | Two rising tones (existing). |
| `workout-complete` | Finish confirmed | Resolving major chord. |

---

## 7. Templates

- **Folders**, one level — "PPL 6-day" containing "Push A", "Pull A", "Legs A".
- **Start from template** instantiates `workout` + `workout_exercises` + planned `sets`, so the session reads as a checklist of placeholders.
- **Adherence** — because `workouts.template_id` is recorded, planned-vs-actual (D-38) comes free.
- **Progression rules** (Phase 4): per template-exercise, a declarative rule — "+2.5 kg when all sets hit the top of the rep range at RPE ≤ 8" — applied at instantiation to seed targets. The deterministic version of programming automation, covering most of the value before any LLM.

### 7.1 Save-as-template is reachable from everywhere a workout is

A workout can become a template from **four** places, because the moment someone decides a session is worth repeating is not predictable:

| Where | Control |
|---|---|
| Finish summary | Name field, inline |
| Active workout | Session `⋯` → Save as template |
| History list row | Swipe-right, or row `⋯` → Save as template |
| History detail | Session `⋯` → Save as template |

All four call one repository function. The earlier build offered this only on the finish sheet, which made it unreachable for anything already logged.

### 7.2 Repeating a past workout

**Repeat this workout** instantiates a new session with the same exercises and set structure, with **placeholders drawn from that specific session's numbers** rather than from the most recent performance. Repeating a session from six weeks ago should suggest what was done then; that is the point of choosing it.

Distinct from saving a template: no template row is created, it is a one-off copy.

Reachable from the history row's `⋯`, from history detail, and from the start screen (§7.4).

### 7.4 The start screen is a list of past workouts

Tapping `+` opens a screen whose body is **recent sessions, tappable to repeat** — not a single "repeat last workout" button. The most likely next workout is one of the last several, not always the immediately previous one, and a button that only offers the latest forces a detour through History for the common case of running a 3-day rotation.

```
┌───────────────────────────────────────────┐
│ ←  Log a workout                          │
├───────────────────────────────────────────┤
│         Start an empty workout            │
├───────────────────────────────────────────┤
│  TEMPLATES                                │
│  Push A            6 exercises        →   │
│  Pull A            6 exercises        →   │
├───────────────────────────────────────────┤
│  DO ONE AGAIN                             │
│  ● Aug 1 Evening · Push                   │
│    Bench, OHP, Pushdown · 18 sets     →   │
│  ● Jul 30 Morning · Legs                  │
│    Squat, RDL, Calf Raise · 21 sets   →   │
│  ● Jul 28 Evening · Pull              →   │
└───────────────────────────────────────────┘
```

Each row shows the derived title, region dots, exercise names, and set count — enough to recognize the session without opening it. Tapping one starts a copy immediately.

The **"log a past workout"** entry is removed entirely; backdating is the session menu's date control (§6.4).

### 7.3 The exercise library is a first-class screen

`/exercises` is browsable at any time, not only reachable mid-workout while adding an exercise. Everything the create-exercise form captures is visible and editable here.

**List view:** search across names and aliases, filter by region / equipment / movement pattern, sort by name or by most recently trained. Rows show a region swatch, primary muscle, equipment, and last-trained date. Custom rows are badged.

**Detail view** `/exercises/:id`:

| Section | Contents |
|---|---|
| **Taxonomy** | Primary muscle, secondary muscles with contribution weights, region, equipment, movement pattern, tracking type, unilateral flag, bodyweight factor. All editable for custom rows; system rows are read-only but forkable via "duplicate and edit". |
| **Notes** | Cues, seat height, pin setting. Editable for any exercise, including system ones — the note is the user's, even when the definition isn't. |
| **Records** | Every record type held, with dates. |
| **History** | Every session containing this exercise, set by set, newest first. |
| **Charts** | e1RM progression, top-set weight, volume per session. |
| **Actions** | Mark as key lift, archive (never hard-delete — history references it). |

---

## 8. Derived metrics

### 8.1 Definitions — single source of truth

| Metric | Definition |
|---|---|
| **Volume load** | `Σ (effective_weight_kg × reps)` over completed, non-warmup sets |
| **Effective weight** | `weight_reps` → `weight_kg`. `bodyweight_reps` → `bodyweight_kg × factor`. `weighted_bodyweight` → `bodyweight_kg × factor + weight_kg`. `assisted_bodyweight` → `bodyweight_kg × factor − weight_kg`. Time/distance types contribute **no** volume load |
| **Working set** | Any logged set that is not a warmup. The user-facing count of real work. Replaces the earlier "hard set", which was jargon with a hidden `reps ≥ 5` rule — a set of 3 heavy singles is not "easy", and a term nobody can define on sight cannot appear on a stat tile. |
| **Estimated 1RM** | Epley `w × (1 + reps/30)`, **only for reps 1–12**. Above 12 return null rather than a fabricated number |
| **Per-muscle volume** | Primary muscle `1.0 ×` the set's volume; each secondary `contribution ×`. Regions sum their muscles |
| **Intensity** | `weight_kg / e1RM`, reference being the best estimate from the trailing 90 days |
| **Cardio load** | `duration_seconds` and `distance_m` summed separately; **never** folded into volume load |
| **Pace** | `duration_seconds / distance_m`, normalized per km or mi by `unit_distance` |
| **Streak** | Consecutive ISO weeks with ≥1 workout, in the user's timezone, honoring `week_starts_on` |
| **Tonnage per minute** | Session volume / duration. A crude density proxy — label it as such |

### 8.2 Where aggregation runs

| Case | Where |
|---|---|
| Active workout, last-time, PR check | Client / IndexedDB — must be offline and instant |
| Charts over ≤ 1 year | Client — data is already local |
| All-time charts, correlation matrix, heavy pivots | Postgres RPC |
| AI context summary | Postgres RPC (§13) |

Chart RPCs are `stable` functions taking `(p_from date, p_to date, p_bucket text)` returning long-format rows the chart layer pivots. They read through the same RLS policies — no privileged path. **No materialized views in v1**; at 35,000 sets plain indexed aggregates are milliseconds, and a stale matview is worse than a slow query.

### 8.3 Required parity test

`lib/metrics.ts` and the SQL functions must agree on a shared fixture dataset. Two implementations exist because charts over years must aggregate server-side while the active-workout screen must compute offline — but a stat tile and a chart disagreeing on "total volume" is a credibility-ending bug.

---

## 9. Chart catalog — 41 charts

Sub-tabs: **Overview · Strength · Volume & Balance · Consistency · Body**

One filter row above all charts in a tab, scoping every chart in it: date range (4W / 12W / 6M / 1Y / All / custom) plus an exercise or region selector where relevant. Filter state lives in URL search params. Per-chart filters are forbidden — they make two charts on one screen show different slices and quietly lie about the comparison.

### 9.0 Chart navigation and filtering

41 charts and a growing exercise library cannot be navigated by a row of pills — with dozens of exercises the pills wrap into a wall and stop being scannable. So the Insights tab is structured, not flat:

**Sub-tab row** (5, fixed): Overview · Strength · Volume · Consistency · Body. Always visible, never wraps.

**One filter bar below it**, scoping every chart in the active sub-tab. It is a single row of *summary chips* that open sheets, so the bar never grows with the data:

```
[ 12W ▾ ]  [ All body parts ▾ ]  [ All exercises ▾ ]
```

| Chip | Opens | Behavior |
|---|---|---|
| **Range** | Preset list — 4W / 12W / 6M / 1Y / All / custom | Single select |
| **Body part** | The 7 regions with color swatches, then muscles nested under each | Multi-select; chip reads "3 body parts" past one |
| **Exercise** | **Searchable** sheet, recently-trained first, grouped by region | Multi-select; chip reads "Bench Press +2" past one. Search is what keeps this usable at 200 exercises. |

Filter state lives in URL search params, so a chart view is shareable and survives reload. Per-chart filters are forbidden — two charts on one screen showing different slices quietly lie about the comparison.

**Chart selection within a sub-tab.** Each sub-tab renders its charts in a fixed order with an "all charts" affordance, plus a **chart picker** so a user who cares about three specific charts can pin them. Pins live in `profiles.chart_prefs`.

**Empty and sparse states are per-chart.** A chart needing 2+ data points says what it needs rather than rendering an empty axis: "Log this lift twice to see progression."

### Overview

| # | Chart | Question | Form | Color |
|---|---|---|---|---|
| A-1 | Weekly volume | This week's total load | Hero figure ≥48px + Δ vs last week | — |
| A-2 | KPI row | Workouts, working sets, streak, avg duration | 4 stat tiles, each with a 12-week sparkline | 1 hue |
| A-3 | Training calendar | When do I train? | Calendar heatmap, cell intensity = session volume | Sequential |
| A-4 | Volume trend | Is total work rising? | Line + 4-week moving average | 1 hue + gray |
| A-5 | Sets by body part | Am I balanced now? | Horizontal bar, 7 regions, target bands behind | Categorical |
| A-6 | Recent PRs | What did I beat? | List of 5 — not a chart | Status: good |
| A-7 | Next up | What should I train? | Card: least-recently-trained region + last template | — |

### Strength

| # | Chart | Question | Form | Color |
|---|---|---|---|---|
| B-8 | e1RM progression | Getting stronger on this lift? | Line, **emphasis** — selected lift in slot 1, related lifts gray | 1 hue + gray |
| B-9 | Top-set weight | Heaviest set per session | Line with markers | 1 categorical |
| B-10 | Rep-max curve | Strength across the rep range | Bar, 1/3/5/8/10/12RM; measured marked distinctly | Ordinal ramp |
| B-11 | Weight × reps cloud | Shape of my performances | Scatter, one point per set, iso-1RM reference curves | **Sequential by recency** (§10.2 caps categorical scatter at 3) |
| B-12 | PR timeline | When did I break through? | Event dot plot, one lane per record type | Categorical, ≤4 lanes |
| B-13 | Push : pull ratio | Is pressing outrunning pulling? | Line vs 1.0 baseline | Diverging |
| B-14 | Strength / bodyweight | Lifts vs my weight | Horizontal bar of ratios for **user-flagged key lifts** (`is_key_lift`), with novice/intermediate/advanced bands | 1 hue + bands |
| B-15 | Overload rate | What's moving, what's stuck? | Diverging horizontal bar, % change in e1RM | Diverging |
| B-16 | Stalled lifts | What needs attention? | **Table** — lift, last PR, weeks stalled, current e1RM | Status |
| B-17 | Per-exercise volume | Work on one lift over time | Bar | 1 hue |
| B-18 | Estimated vs actual 1RM | Is my estimate trustworthy? | Dumbbell | 1 hue, 2 shades |
| B-19 | Time to progress | How long to add 2.5 kg? | Histogram of days-between-PRs | 1 hue |

### Volume & Balance

| # | Chart | Question | Form | Color |
|---|---|---|---|---|
| C-20 | Region share of work | Where does my training go? | **Horizontal 100% stacked bar** default; donut available as a toggle | Categorical |
| C-21 | Region volume over time | How has emphasis shifted? | Stacked area, 7 regions | Categorical |
| C-22 | Weekly sets vs targets | Inside a productive range? | Horizontal bar per muscle with **user-editable** MV/MEV/MAV/MRV marks | 1 hue + status marks |
| C-23 | Antagonist balance | Opposing muscles matched? | Diverging bar — quad↔ham, chest↔back, bi↔tri, front↔rear delt | Diverging |
| C-24 | Left vs right | Side asymmetry? | Dumbbell per unilateral exercise | 1 hue, 2 shades |
| C-25 | Pattern coverage | Missing a movement pattern? | Horizontal bar, sets per pattern + target line | 1 hue |
| C-26 | Equipment mix | Where does training happen? | Horizontal bar | 1 hue |
| C-27 | Rep-range distribution | Only training one way? | Stacked bar over time — 1–5 / 6–8 / 9–12 / 13–20 / 20+ | **Ordinal ramp** (buckets are ordered) |
| C-28 | Intensity distribution | How heavy do I train? | Histogram of % e1RM | Ordinal ramp |
| C-29 | RPE over time | Pushing harder or coasting? | Banded line, median + IQR per month | 1 hue + band |
| C-30 | Sets per session | Session length creeping? | Histogram | 1 hue |
| C-31 | Volume vs duration | Denser or just slower? | Scatter per session + trend line | 1 hue |
| C-32 | Neglected muscles | Untrained for a month? | **Table** | Status |
| C-33 | Exercise variety | Distinct lifts per month | Line | 1 hue |

### Consistency

| # | Chart | Question | Form | Color |
|---|---|---|---|---|
| D-34 | Workouts per week | Holding the habit? | Bar + target line | 1 hue |
| D-35 | Day-of-week frequency | Which days do I show up? | Bar, Mon–Sun | 1 hue |
| D-36 | Rest taken vs target | Resting as long as I think? | Histogram of measured rest, target marked | 1 hue + reference |
| D-37 | Time of day | When do I train? | Histogram over 24h | 1 hue |
| D-38 | Template adherence | Do I follow my plan? | Dumbbell, planned vs actual sets | 1 hue, 2 shades |
| D-39 | Gap distribution | How long are layoffs? | Histogram of days between sessions | 1 hue |
| D-40 | Duration trend | Workouts getting longer? | Line + moving average | 1 hue + gray |
| D-41 | Cardio volume | Time and distance over time | Line, duration and distance as **two separate charts** — never two y-axes | 1 hue each |

### Body

| # | Chart | Question | Form | Color |
|---|---|---|---|---|
| E-42 | Bodyweight trend | Which way am I going? | Raw points gray + 7-day moving average in slot 1 — **emphasis**, because daily weight is noise | 1 hue + gray |
| E-43 | Body composition | Muscle or fat? | Stacked area, lean + fat mass | Categorical, 2 series |
| E-44 | Circumferences | Where am I changing? | **Small multiples**, one mini-line per site, shared y-scale | 1 hue across facets |
| E-45 | Strength vs bodyweight | Gaining strength faster than weight? | Line, **both series indexed to 100 at range start, one axis** | Categorical, 2 series |
| E-46 | Vitals | Resting HR / HRV | Line, one metric at a time | 1 hue |
| E-47 | Sleep vs next-day volume | Does sleep affect training? | Scatter + trend | 1 hue |
| E-48 | Metric correlation | What moves together? | Heatmap correlation matrix | Diverging, gray at zero |
| E-49 | Progress photos | Visual change | Side-by-side comparison slider (Phase 8) | — |

**No chart in this app uses two y-axes.** Two measures of different scale become two charts, small multiples, or both indexed to a common base — E-45 and D-41 are the two places this rule bites. Dual-axis plots make the reader see a correlation that is an artifact of arbitrary axis alignment.

C-20 defaults to a stacked bar rather than a pie: with 7 regions often close in size, angle comparison is the task human vision is worst at, and length is read accurately. The donut toggle stays because it reads well when one region dominates.

---

## 10. Chart design system

### 10.1 Order of operations

Choose form by the data's job → assign color by *its* job → **validate the palette by running a checker**, never by eye. Colorblind safety is computable.

### 10.2 Region palette — fixed assignment

Region → color never changes. Colors follow the entity, not its current rank, so filtering a region out must never repaint the survivors.

| Slot | Region | Light | Dark |
|---|---|---|---|
| 1 | Chest | `#2a78d6` | `#3987e5` |
| 2 | Back | `#eb6834` | `#d95926` |
| 3 | Legs | `#1baf7a` | `#199e70` |
| 4 | Shoulders | `#eda100` | `#c98500` |
| 5 | Arms | `#e87ba4` | `#d55181` |
| 6 | Core | `#008300` | `#008300` |
| 7 | Cardio | `#4a3aa7` | `#9085e9` |

**Validator results (run, not estimated):**

- **Light, adjacent pairs:** all checks pass. Worst adjacent CVD ΔE **9.1** (protan, shoulders↔legs) against a ≥8 target; worst normal-vision ΔE **19.6** against a ≥15 floor. **One WARN:** legs (2.74:1), shoulders (2.11:1), and arms (2.62:1) fall below 3:1 contrast on the light surface. This **obligates** visible direct labels or the table view on any chart using them — not dismissable.
- **Dark:** all checks pass, no warnings. Worst adjacent CVD ΔE **8.4**, normal-vision **19.3**, all 7 clear 3:1.
- **All-pairs forms** (scatter, bubble, small multiples): only the **first 3 slots** validate (worst CVD ΔE 9.2, normal-vision 24.0 light). Slot 4 puts yellow beside orange and fails. **Scatter-type charts cap at 3 categorical series** — beyond that, facet or fold into "Other". This is why B-11 uses a recency ramp.

Never generate an 8th or 9th hue — a generated color is indistinguishable from an existing slot under CVD.

### 10.3 Other color jobs

- **Sequential** (magnitude — A-3, intensity bins): one hue light→dark, blue `#cde2fb` → `#0d366b`. Never rainbow.
- **Diverging** (polarity — B-13, B-15, C-23, E-48): blue ↔ red with a **neutral gray** midpoint (`#f0efec` light, `#383835` dark), equal steps per arm. The midpoint must read as "nothing", hence gray not a third hue.
- **Status** (state — PR badges, stalls, deltas): good `#0ca30c`, warning `#fab219`, serious `#ec835a`, critical `#d03b3b`. **Reserved** — never a series color. Always paired with an icon and text label; on the light surface warning and serious sit below 3:1 by design and must not carry meaning by color alone.

Delta direction reads `metric_definitions.higher_is_better`; where it is `null`, **no color is applied** — inventing a valence is worse than omitting one.

### 10.4 Marks and chrome

2px lines · ≥8px markers with a 2px surface ring where they overlap · 4px rounded bar ends anchored to the baseline · a **2px surface gap** between stacked segments and adjacent bars rather than a border drawn around marks · gridlines and axes as **solid hairlines** one shade off the surface (`#e1e0d9` light, `#2c2c2a` dark), never dashed.

Text always wears text tokens (`#0b0b0b` / `#52514e` / muted `#898781`), never the series color — a colored mark beside the label carries identity. Direct-label **selectively** (endpoint, extreme, the series that matters), never a number on every point. Hero and stat values use proportional figures; `tabular-nums` only in table rows and axis ticks.

Define palette slots as CSS custom properties under a `.viz-root` scope, declared for both `prefers-color-scheme: dark` and a `[data-theme]` toggle so the theme switch wins both ways.

### 10.5 Accessibility

- ≥2 series → legend always present, and at ≤4 series also direct-labeled. Identity is never color-alone. A single-series chart needs no legend; the title names it.
- **Every chart has a table-view twin** via the card's `⋯` menu — both an accessibility requirement and the relief for the §10.2 contrast WARN.
- Dark mode is a **selected** palette validated against the dark surface, not an inversion.
- Opt-in texture fill (45°/135° hatching, tone-on-tone) for full CVD, print, and `forced-colors`. Off by default.
- Honor `prefers-reduced-motion` — no entry animations.

### 10.6 Interaction

- Hover/touch layer on every plotted chart: crosshair + tooltip on lines and areas, per-mark tooltip on bars, dots, cells. Touch targets ≥24px, larger than the mark; dense scatter uses a nearest-point layer.
- Tooltips **enhance, never gate** — every value is also reachable by direct label or table view; keyboard focus shows the same content as hover.
- Pinch-zoom and pan on long series via ECharts `dataZoom`, double-tap to reset.
- On refetch, hold the previous render at reduced opacity. **No skeleton flash.**

### 10.7 Chart library

**Apache ECharts**, tree-shaken — register only the used chart types and components.

It covers every form here including heatmaps (A-3, E-48), banded/boxplot forms (C-29), and dumbbells; renders to canvas so a 500-point scatter stays smooth on a phone; and ships real touch interaction and `dataZoom`. The Insights tab is **lazy-loaded as its own route chunk** so the logging path never pays for it. One `<Chart>` wrapper owns `setOption`, resize observation, and **disposal on unmount**.

Fallback if bundle size dominates: Observable Plot — far more concise, weaker touch.

### 10.8 Themes

Two independent axes, because they carry different risk.

**1. UI theme — free to change.** A set of hand-built presets, each shipping validated light and dark variants. These control surfaces, ink, and the accent used by buttons, active tab states, and focus rings.

| Theme | Character |
|---|---|
| Default | Neutral warm gray, blue accent |
| Slate | Cool gray, indigo accent |
| Forest | Warm sand surfaces, deep green accent |
| Ocean | Cool surfaces, teal accent |
| Sunset | Warm surfaces, burnt-orange accent |
| Crimson | Neutral surfaces, deep red accent |
| Mono | Pure grayscale, near-black accent |

Plus a **custom accent color picker**, which overrides the preset's accent only. The picker enforces a contrast floor against both the light and dark surfaces and nudges the chosen color to the nearest passing step rather than accepting an unreadable one.

**2. Chart region palette — fixed.** The 7 region colors in §10.2 are *not* themeable. Their specific ordering is what passes the colorblind-separation gates; almost any hand-picked 7-color set fails them, and a chart whose categories are indistinguishable under CVD is worse than a generic-looking one. Region colors are also load-bearing for recognition — "back is orange" has to keep being true.

Chart *chrome* (surface, gridline, axis, ink) does follow the theme, so charts sit correctly on themed surfaces without touching series identity.

**The accent never draws a chart mark.** Each theme's accent was measured against all 7 region colors, both schemes (OKLab ΔE ×100, series floor ≥15):

| Theme | Light — nearest region | Dark — nearest region |
|---|---|---|
| Default | chest **0.0** | chest **0.0** |
| Slate | cardio 6.1 | cardio 5.5 |
| Forest | core 7.1 | legs **4.0** |
| Ocean | chest 13.1 | legs 10.6 |
| Sunset | back 9.8 | back 8.2 |
| Crimson | back 18.6 ✓ | arms **4.2** |
| Mono | cardio 27.3 ✓ | shoulders 31.9 ✓ |

Only Mono clears the floor in both schemes. So single-series charts draw in **categorical slot 1**, fixed, rather than the accent — otherwise the same green would be a button in one card and "legs" in the next. Interactive chrome *inside* a chart card (filter chips, the table toggle) still uses the accent, because those are controls, not marks.

**Implementation.** Every theme is a block of the same CSS custom properties in `styles/themes.css`, applied by a `data-theme` attribute on `<html>`; `data-scheme` selects light or dark within it. Nothing in the app reads a hardcoded color — the audit is `grep` for hex literals outside the theme files. Stored in `profiles.theme` and `profiles.accent_override`.

---

## 11. Auth, privacy, data ownership

### 11.1 Auth

Supabase Auth. **Email magic link** primary — no passwords to store, reset, or leak. **Google OAuth** secondary. Signup is invite-only via `allowed_emails` (§4.13).

Sessions: JWT in memory, refresh on foreground. **A refresh failure while offline must not log the user out or clear IndexedDB** — the app stays fully read/write against local data and re-authenticates when the network returns. This needs an explicit test; getting it wrong means a gym with no signal logs you out and hides your workout.

### 11.1.1 The auth interface

Auth sits behind one interface, so the whole front end can be built and tested against a local implementation before any Supabase project exists — and so the eventual swap touches one file.

```ts
interface AuthProvider {
  getSession(): Promise<Session | null>
  onSessionChange(cb: (session: Session | null) => void): () => void
  signInWithEmail(email: string): Promise<{ sent: true } | { error: string }>
  verifyOtp(email: string, code: string): Promise<Session | { error: string }>
  signInWithGoogle(): Promise<Session | { error: string }>
  signOut(): Promise<void>
  updateProfile(patch: { displayName?: string; avatarColor?: string }): Promise<void>
  deleteAccount(): Promise<void>
}

interface Session {
  userId: string
  email: string
  displayName: string
  createdAt: number
  /** False until the magic link or OTP is confirmed. */
  isVerified: boolean
}
```

**`LocalAuthProvider`** ships first: a single local account, no network, no password. It exists so the sign-in, account, and sign-out surfaces are real and exercised rather than stubs — the screens that break at the boundary between "signed out" and "signed in" are the ones nobody tests. **`SupabaseAuthProvider`** replaces it in Phase 5 with no change above the interface.

### 11.1.2 Screens

| Screen | Contents |
|---|---|
| **Sign in** `/auth` | App name, one-line pitch, email field → "Send me a link", Google button, and — for the local provider — a "Continue" that creates the local account. Invite-only is stated up front, so a stranger isn't left waiting for a link that will never arrive. |
| **Check your email** | Confirmation with the address shown, a resend timer, "wrong address?" back link, and a 6-digit code field as the fallback when the link opens in the wrong browser. |
| **Account** `/me/account` | Display name (editable inline), email, member-since, sign out, export data, delete account. |

**Sign-out placement.** In Account, behind the More tab — never in the tab bar and never one tap from a logging screen. It also **warns and blocks when the outbox is non-empty**: signing out with unsynced writes would strand them, so the dialog says how many are pending and offers to wait.

**Delete account** requires typing the word `delete`, states plainly that all workouts and body metrics go with it, and offers an export first. Irreversible and destructive, so friction is the correct design.

### 11.1.3 What multi-user changes

The prototype's `LOCAL_USER_ID` constant becomes the session's user id. Everything already carries `user_id`, so the change is mechanical — but three things need care:

1. **A signed-out app shows the auth screen, not an empty app.** No screen may render a partially-populated shell while unauthenticated.
2. **Switching accounts must clear the local database.** Otherwise user B reads user A's cached IndexedDB rows — an RLS bypass that happens entirely client-side and which server policies cannot prevent.
3. **Seeding is per-account.** The system library is shared (`user_id is null`), but the profile row is per user.

### 11.2 Privacy

This app holds body weight, body-fat percentage, and years of behavioral data. Treat it as health data.

RLS on every table, enforced by tests. No third-party analytics, no error-reporting SDK that captures request bodies, no ad tech. Progress photos (Phase 8) live in a private bucket behind short-lived signed URLs and are never synced to IndexedDB. The AI feature is opt-in, default off, and sends a de-identified aggregate.

### 11.3 Export and import

Full versioned JSON export of everything from Settings, generated by an Edge Function and streamed as a download. Per-table CSV for spreadsheets. Import accepts the same JSON for restore.

This is simultaneously the backup mechanism (§5.4), the migration path off this app, and what makes depending on a free tier acceptable — the data is never hostage to a pricing decision.

---

## 12. Rest timer and notifications

Layered so each tier degrades into the next. The timer's authoritative state is a **target timestamp**, not a decrementing counter, so backgrounding and returning shows the correct remaining time.

### 12.1 Tier 1 — foreground (reliable)

In-app countdown in the sticky bar. Starts on set completion using the per-exercise override, else the profile default of 60s. Controls: `+30s`, `−30s`, skip, long-press to change that exercise's default.

On expiry: Web Audio chime and `navigator.vibrate()` where supported (Android; iOS Safari has no Vibration API). **The `AudioContext` must be unlocked by a user gesture** — initialize on the session's first tap or the chime silently fails. Optional Wake Lock keeps the countdown visible.

### 12.2 Tier 2 — service worker (opportunistic)

The service worker holds the target timestamp and fires `showNotification()` on expiry. Reliable on Android and desktop; on iOS the SW may be suspended, in which case this silently no-ops. Near-zero cost, covers brief app switches.

### 12.3 Tier 3 — server-scheduled push

Required because **WebKit has no Notification Triggers API** (§2) — a timed notification must be scheduled off-device.

Supabase `pg_cron` has one-minute granularity, unusable for a 60-second timer (±60s error exceeds the interval being measured). So use a **Cloudflare Durable Object alarm**: schedules to the second, free at this volume. On set completion the client POSTs `{fire_at, workout_id}` to a Worker; the DO sets an alarm; on wake it sends Web Push via VAPID using the §4.10 subscription. No FCM, no third-party service, no Apple Developer account.

Requirements: iOS clients must be installed to the Home Screen and must have granted permission from an explicit button tap. Allow `*.push.apple.com`. Set `userVisibleOnly: true`. Handle `pushsubscriptionchange` by re-subscribing. Consider **Declarative Web Push** (Safari 18.4+) as a more reliable fallback payload format.

**Cancellation is mandatory** — starting the next set, skipping rest, or finishing the workout must cancel the pending alarm, or the user gets buzzed after leaving the gym.

### 12.4 Abstraction

```ts
interface TimerService {
  start(seconds: number, ctx: { workoutId: string; exerciseId: string }): void
  cancel(): void
  extend(seconds: number): void
  onExpire(cb: () => void): () => void
}
```

`WebTimerService` (tiers 1–3) now; a `NativeTimerService` behind a Capacitor wrapper later if needed.

### 12.5 Other notifications

Off by default, individually toggleable, all respecting quiet hours: workout reminders on a schedule, weekly summary, "you haven't trained in N days". Notification fatigue is how an app gets its permission revoked.

---

## 13. AI coach

**In scope:** given history and a stated goal — critique balance and progression, produce a concrete next-week plan as templates, suggest per-exercise progression, answer freeform questions about the user's own history.

**Out of scope:** medical or injury advice, nutrition prescription, anything phrased as certainty. Output is always a suggestion, always editable before becoming a template, never auto-applied.

**Design constraint (from §2): never send raw rows, never send anything identifying.** An Edge Function builds a compact de-identified summary server-side — aggregates per exercise and per week, no name, no email, no free-text notes, dates reduced to week offsets. This also shrinks the prompt from tens of thousands of tokens to ~2–5k, which is what makes the free tier viable and the responses better-focused.

**Provider:** Cloudflare Workers AI (10,000 Neurons/day free, hard-fails instead of billing) — comfortably more requests/day than 5 users generate at a ~3k-token summary. Confirm its data policy first (§2). Fallback: DeepSeek at ~$0.14/M input, roughly $2/month here, 50× cheaper on cache hits. Provider sits behind a small interface. **API keys live only in Worker/Edge Function secrets** — never the client bundle.

**Implementation:** structured output via JSON Schema so a plan deserializes straight into `templates` + `template_exercises` rather than being parsed from prose. Server-side per-user rate limit. Cache generated plans. Show the user exactly what was sent via a "view the data sent" disclosure — opt-in without visibility isn't meaningful consent.

The deterministic progression rules in §7 ship first and cover most of the practical value.

---

## 14. Implementation tracker

The strategy is **front-end complete against local storage first**, then attach the backend. IndexedDB is the authoritative read path either way (§5.5), and every mutation already queues to the outbox, so sync is an addition rather than a rewrite. This lets the whole interaction design be refined against real use before any schema is committed to a server.

Legend: ✅ done · 🔨 in progress · ⬜ not started

### Phase 1 — Logging loop ✅

| Item | Status |
|---|---|
| Domain types mirroring the Postgres schema | ✅ |
| `lib/units.ts` with exact round-trip property tests | ✅ |
| `lib/dates.ts` timezone-aware bucketing | ✅ |
| `lib/metrics.ts` volume, e1RM, attribution, cardio isolation | ✅ |
| Dexie schema + outbox queue on every mutation | ✅ |
| Seed library — ~100 exercises, 27 muscles, 27 biomarkers | ✅ |
| Repository as the single data-access boundary | ✅ |
| Active workout screen, cardio input switching | ✅ |
| PR detection, computed locally, recomputed from scratch on edit | ✅ |
| `last_performance` cache | ✅ |
| Finish summary with region split | ✅ |
| History list and detail, past-workout editing | ✅ |
| Rest timer with chime and vibration | ✅ |
| Body metric entry | ✅ |

### Phase 2 — Interaction refinement 🔨

Driven by first-use feedback. Each item replaces something that tested poorly.

| Item | Replaces | Status |
|---|---|---|
| **Placeholder-based logging** (§6.2) — type to commit, no confirm circle | Pre-filled real values + a confirm circle that communicated nothing | ✅ |
| **PR glow** on a qualifying row (§6.2) | Post-hoc toast only | ✅ |
| **"Working sets"** language (§8.1) | "Hard sets" — undefinable jargon on a stat tile | ✅ |
| **Exercise detail sheet** (§6.3) | A `⋯` button that did nothing | ✅ |
| **Automatic session titles** (§6.7) | Every finished session titled "Workout" | ✅ |
| **Drag to reorder, drag-onto to superset** (§6.4) | A separate select-then-group superset mode | ✅ |
| **Session menu** with date/time change (§6.4) | A separate "log a past workout" entry point | ✅ |
| **Save-as-template from 4 places** (§7.1) | Finish sheet only | ✅ |
| **Repeat workout from history** (§7.2) | Only "repeat last workout" from the start screen | ✅ |
| **Exercise library screen** (§7.3) | Taxonomy visible only while creating an exercise | ✅ |
| **Sound cue set** (§6.8) | Rest-complete chime only | ✅ |
| **Theme presets + custom accent** (§10.8) | One hardcoded blue-on-gray scheme | ✅ |
| **Insights sub-tabs + searchable filters** (§9.0) | A flat pill row that breaks past ~10 exercises | ✅ |
| Discard-empty-sets on finish (§6.2) | Empty placeholder rows persisting into history | ✅ |

### Phase 2b — Second-pass refinement ✅

A second round of first-use feedback. Every item replaces something that read
wrong in practice.

| Item | Replaces | Status |
|---|---|---|
| **Explicit rest button** (§6.4.2) | Implicit start on every logged set — unpredictable, and its trigger was invisible | ✅ |
| Auto-start rest as an opt-in setting (§6.4.2) | Always-on implicit behavior | ✅ |
| **Cardio entry block** (§6.5.1) | A numbered set table, which doesn't fit one continuous effort | ✅ |
| **Add-set carries a placeholder** (§6.2 rule 3) | A blank row at the moment the user is most tired | ✅ |
| **Repeat any past session from the start screen** (§7.4) | A single "repeat last workout" button | ✅ |
| Placeholders from the *chosen* session (§7.2) | Always the most recent performance | ✅ |
| **Empty workouts are discarded** (§6.4.1) | Saving a row that records nothing | ✅ |
| **Swipe-dismissable toasts** | A toast that could only time out | ✅ |
| **Recent rows carry real information** (§5.2.1) | Every row reading "Workout" | ✅ |
| **Week figure carries a Δ vs last week** (§5.2.1) | A bare number with no comparison | ✅ |
| **Greeting with the user's name** (§5.2.1) | No personalization | ✅ |
| Audio unlocked app-wide (§6.8) | Unlocked only on the workout screen, so cues were silent elsewhere | ✅ |
| Default theme applied before first paint | Accent-colored elements invisible on the sign-in screen | ✅ |
| "Log a past workout" entry point removed (§6.4) | A second flow doing what the date control already does | ✅ |
| Cardio seeded with one entry, not three (§6.5.1) | Three rows implying interval structure nobody asked for | ✅ |

### Phase 2c — Auth front end ✅

Built against `LocalAuthProvider` so every screen is real before Supabase exists
(§11.1.1).

| Item | Where | Status |
|---|---|---|
| `AuthProvider` interface + local implementation | §11.1.1 | ✅ |
| Sign-in screen — email, code fallback, Google, offline | §11.1.2 | ✅ |
| Check-your-email panel with resend timer | §11.1.2 | ✅ |
| Account screen — name, email, stats, member-since | §11.1.2 | ✅ |
| Sign-out **blocked while the outbox is non-empty** | §11.1.2 | ✅ |
| Delete account behind typing `delete`, wipes local DB | §11.1.2, §11.1.3 | ✅ |
| Signed-out state shows only auth, never a partial shell | §11.1.3 | ✅ |
| Tree remounts on account switch | §11.1.3 | ✅ |

### Phase 2d — Remaining 🔨

| Item | Status |
|---|---|
| Plate calculator | ⬜ |
| Template editor and folders | ✅ |
| Preview past workout / template before starting | ✅ |
| Per-exercise charts on the library detail screen (§7.3) | ⬜ |
| Pinned charts via `chart_prefs` (§9.0) | ⬜ |
| URL search-param filter state (§9.0) | ⬜ |
| Progression rules on templates (§7) | ⬜ |

### Phase 3 — Charts 🔨

21 of 41 built, covering every color job so the system is proven: A-4, A-5, B-8, B-9, B-16, B-17, C-20, C-21, C-25, C-26, C-27, C-30, C-31, C-33, D-34, D-35, D-37, D-39, D-40, D-41, E-42, plus the Overview summary tiles. Each has a table-view twin and a per-chart empty state. The remaining 20 are mostly the Body sub-tab (needs biomarker history) and a few advanced Strength/Volume forms (rep-max curve, PR timeline, antagonist balance).

The remaining 29 follow the same pattern against the §10 design system and §9.0 navigation. The Body sub-tab is the thinnest — it needs logged biomarker history before most of its charts have anything to draw.

### Phase 4 — Offline & PWA ⬜

Workbox service worker, manifest, iOS install education, `navigator.storage.persist()`, crash-safe draft restore. Already functions offline because IndexedDB is the read path; this is the installable shell.

### Phase 5 — Backend 🔨

Supabase project, full schema, RLS policies **plus the RLS test suite**, magic-link + Google auth, the outbox drain, delta pull, tombstones. The front end should need no structural change — only the repository gains a sync path.

Built so far (in `supabase/` and `src/sync/`):

| Item | Status |
|---|---|
| Full SQL schema mirroring §4 (`0001_schema.sql`) | ✅ |
| Server-clock `updated_at`, `rebuild_prs()`, invite + profile hooks (`0002`) | ✅ |
| RLS on every table (`0003_rls.sql`) | ✅ |
| RLS isolation test suite (`tests/rls.test.sql`) | ✅ |
| `SyncBackend` interface + in-memory mock | ✅ |
| Sync engine: ordered drain, failure classification, dead-letter, delta pull, pending-write guard | ✅ |
| Sync engine tests (offline queue, idempotent replay, transient/permanent/auth, tombstones) | ✅ |
| `SupabaseBackend` (camel↔snake, ms↔ISO, HTTP classification) | ✅ |
| `SupabaseAuthProvider` (magic link + OTP + Google), auto-selected when configured | ✅ |
| Drain triggers wired (`useSync`); pending + dead-letter counts in Settings | ✅ |
| Live Supabase project provisioned + migrations applied | ⬜ (needs a project; §4.13 RLS suite must pass first) |
| Bootstrap pull with determinate progress bar | ⬜ |
| `delete-account` Edge Function, `keep_alive` cron | ⬜ |

### Phase 6 — Timer & push ⬜

Service-worker tier, then the Durable Object alarm tier. Reminders with quiet hours.

### Phase 7 — Export, backup, coach ⬜

Full JSON export/import, automated weekly backup to R2, then the AI coach (§13).

### Phase 8 — Photos ⬜

Private bucket, signed URLs, comparison slider (E-49). Client-side compression is mandatory, not an optimization — uncompressed phone photos exhaust the 1 GB free tier in about 15 months.

### 14.1 Testing

- **Unit:** `lib/units.ts` (property-based round-trip), `lib/dates.ts` (October, DST, week starts, timezones), `lib/metrics.ts` (every tracking type, warmup exclusion, bodyweight math, the 12-rep e1RM cutoff, cardio kept out of volume).
- **Parity:** TS and SQL metrics agree on a shared fixture (§8.3).
- **Sync:** outbox against a mock backend — offline queueing, replay idempotency, permanent-vs-transient classification, poison-entry dead-lettering, tombstones, clock skew.
- **Security:** per table, user A cannot read or write user B's rows.
- **E2E (Playwright):** log a workout; save and instantiate a template; edit a past workout and verify PRs recompute; go offline mid-session, force-quit, reopen, reconnect, verify server state.
- **Manual on real devices:** iOS Safari installed to Home Screen (install flow, notification permission from a gesture, audio unlock, locked-screen push), Android Chrome, desktop.

### 14.2 Effort

Solo dev, evenings. Phase 0 ~1wk · 1 ~2wk · 2 ~2wk · 3 ~2wk · 4 ~2–3wk · 5 ~1wk · 6 ~1wk · 7 ~1–2wk · 8 ~0.5wk. **~3–4 months** to complete; daily-usable after about five weeks.

---

## 15. Cost

| Item | Plan | Cost |
|---|---|---|
| Static hosting | Cloudflare Pages free | $0 |
| Postgres + Auth + Storage + Edge Functions | Supabase free (500 MB DB, 50k MAU, 5 GB egress) | $0 |
| Push scheduling, cron, keep-alive, backups | Cloudflare Workers + Durable Objects + R2 free | $0 |
| Web Push delivery | Self-hosted VAPID | $0 |
| AI | Cloudflare Workers AI, 10k Neurons/day | $0 |
| Domain | optional | ~$10/yr |
| **Total** | | **$0** (~$2/mo if AI moves to DeepSeek) |

Watch two dependencies: Supabase's free limits and 1-week pause policy (mitigated §5.4), and the Workers AI daily allowance. Both are de-risked by §11.3 — the data is portable by construction, so a pricing change is an inconvenience, not a crisis.

---

## 16. Shipping to the App Store

### 16.1 The short answer

FitNote is a PWA. Getting it onto the **iOS App Store** does **not** require a rewrite — the React/Vite front end runs unchanged inside a native WebView shell. What it requires is (a) a thin native wrapper, (b) an Apple Developer account, and (c) meeting a handful of review-guideline bars that a pure PWA never has to. No redesign of the app's logic, data model, or UI is needed; the work is packaging, a few native integrations, and store paperwork.

Three honest realities up front:

- **iOS has no "upload a PWA" path.** Unlike Android (where a Trusted Web Activity wraps a PWA almost verbatim), Apple requires a real app binary built with Xcode. A WebView wrapper is the standard, allowed way to produce one.
- **Apple rejects "just a website" apps** (Guideline 4.2 — minimum functionality). A wrapper that only loads a URL risks rejection. FitNote clears this because it's an installed, offline-first app with device integration (local storage, notifications, haptics) — but the native integrations below are what make that case to the reviewer, so they're not optional polish.
- **You already have 90% of it.** Local-first storage, offline operation, an installable manifest, and a service worker are exactly what a good wrapped app needs. The gap is native shell + store assets, not product.

### 16.2 Recommended path: Capacitor

**[Capacitor](https://capacitorjs.com/)** (by the Ionic team) is the right wrapper for this app. It loads the existing built `dist/` in a native WebView, exposes native APIs through a JS bridge, and produces a standard Xcode project. It's the lowest-friction option that still allows real native features.

Why Capacitor over the alternatives:

| Option | What it is | Verdict for FitNote |
|---|---|---|
| **Capacitor** | Native shell around the web build; JS bridge to native APIs | **Recommended.** Minimal code change, keeps one codebase, real native push/haptics/filesystem. |
| **PWABuilder** | Microsoft tool that generates a wrapper (uses a packaged WebView) | Fine for Android/Windows; its iOS output is less maintained and gives less control than Capacitor. Good for a quick spike. |
| **React Native / Expo** | A true native rewrite of the UI | Overkill. Throws away the working web app to solve a packaging problem. Only worth it if the app ever needs heavy native UI. |
| **TWA (Trusted Web Activity)** | Android-only; wraps the live PWA with no WebView chrome | Best **Android/Play Store** path (near-zero packaging), but iOS still needs Capacitor, so Capacitor covers both. |

### 16.3 What the build process looks like

One-time setup:

1. `npm install @capacitor/core @capacitor/cli && npx cap init FitNote com.hirshguha.fitnote`
2. Set Capacitor's `webDir` to `dist` and build with `BASE_PATH=/ npm run build` — **the app must be served from the bundle root inside the shell**, not the `/workout-tracker/` subpath the web deployment uses (§5, `vite.config.ts` already makes `BASE_PATH` overridable for exactly this).
3. `npx cap add ios` (and `npx cap add android`) to generate the native projects.
4. Point the app at the hosted Supabase backend (unchanged) — the wrapper is just a client.

Each release:

1. `BASE_PATH=/ npm run build`
2. `npx cap copy` (pushes the fresh `dist/` into the native projects)
3. `npx cap open ios` → Xcode → Archive → upload to App Store Connect via TestFlight, then submit for review.

CI can automate steps 1–2 and the Xcode Archive with `fastlane`, but for a ~5-user app manual Xcode upload is fine.

### 16.4 What actually needs to change in the app

Small, additive — no redesign:

- **Native push instead of Web Push.** The Tier-3 push design (§12.3) uses VAPID Web Push, which iOS only supports for installed PWAs and unreliably. In a wrapped app, swap to **APNs via `@capacitor/push-notifications`**. The §12.4 `RestScheduler`/notification abstraction was written for exactly this — it's one implementation swap behind a stable interface, no caller changes.
- **Native file save/open for export/import (§11.3)** via `@capacitor/filesystem` + share sheet, instead of the browser download/upload. Same JSON payload; different I/O boundary. Keep the web path too — one `if (Capacitor.isNativePlatform())` fork.
- **Safe-area & status bar**: already handled by the `viewport-fit=cover` + `pt-safe`/`pb-safe` classes; verify against the iOS notch in the shell.
- **Haptics** (`@capacitor/haptics`) on set-logged / PR — optional, but it's the kind of native touch that both improves feel and strengthens the "not just a website" case.
- **Remove the iOS "Add to Home Screen" education card (§5.8)** when running natively — it's meaningless in a wrapped app. Gate it on `!Capacitor.isNativePlatform()`.

Explicitly **not** needed: no change to the data model, the repository/sync layer, the charts, the metrics, or any screen's layout. The WebView renders the same DOM.

### 16.5 Store requirements checklist

- **Apple Developer Program** membership — **$99/year** (this breaks the app's $0 running cost; it's the one unavoidable fee). Google Play is a **$25 one-time** fee if Android is wanted too.
- **App icons and launch screen** in native densities — generated from the existing `public/icon.svg` (`@capacitor/assets` automates this).
- **Privacy nutrition label / `App Privacy` questionnaire.** FitNote is easy here: data is local-first and only syncs to the user's own Supabase row; no third-party tracking, no ads, no data sold. §11.2 already states the posture.
- **A privacy policy URL** (required even for trivial data use). A short static page suffices.
- **Screenshots** for the required device sizes, and a review note explaining the offline-first, single-user nature so the reviewer understands the (intentionally minimal) sign-in.
- **Account deletion** must be in-app if there are accounts — already covered by the delete-account flow (§11.1.2).

### 16.6 Recommendation

For reaching a few users on iPhone, wrap with **Capacitor**, swap Web Push → APNs and the export I/O to native file APIs behind the existing abstractions, pay the $99/year Apple fee, and submit. Budget the real effort as **days, not weeks** — most of it is the Apple account, icons/screenshots, and one round of review feedback, not code. Keep shipping the PWA in parallel; the wrapper is an additional distribution channel over the same build, not a replacement.
