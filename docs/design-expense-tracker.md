# Design: Expense Tracker on the shared local-first stack

**Status:** Design / roadmap (not started)
**Working codename:** *Ledger* (brand TBD — e.g. Tally, Coin, Reckon, Balance)
**Author:** design doc, 2026-08-23
**Related:** [design-native-app.md](design-native-app.md), the modularization plan (`~/.claude/plans/reactive-rolling-mountain.md`), [design-social-leagues.md](design-social-leagues.md)

## 1. Thesis

REPutation is a local-first React + Capacitor app whose sync layer, auth, platform
wrappers, UI kit, and AI-coach pattern are **already domain-agnostic**. We can stand
up a second app — a personal-finance / expense tracker — that reuses all of that,
by (a) extracting the shared machinery into packages and (b) writing a new
finance domain + feature set on top.

The one genuinely new capability is **account aggregation** ("connects to all my
accounts"): pulling live balances and transactions from banks via Plaid. That
forces one architectural change from REPutation's pure client-authored model —
some tables become **server-authored, pull-only** — but the existing sync engine
already handles exactly that case (server row wins unless a local write is pending).

## 2. What's already reusable (evidence)

I audited the current tree. The sync core is domain-agnostic; only four small
functions hardcode "workout":

- **`sync/engine.ts`** — outbox drain (parents-before-children, backoff,
  dead-letter, max-attempts), delta pull, `retryDeadLettered`, `discardLocalChanges`,
  `hardDeleteServerData`. The only workout-specific parts are `SYNCED_TABLES`,
  `parentRowId()`, `normalizeRow()`, and `tableStore()` — all pure configuration.
- **`sync/backend.ts`** — `SyncBackend` (push/pull/hardDeleteAll on `{table, row}`)
  is **already fully generic**. The Supabase implementation (`supabaseBackend.ts`,
  `columnCase.ts`) is reusable verbatim.
- **`db/database.ts`** — `outbox` / `deadLetter` / `syncState` tables + `syncStamp()`
  / `touch()` are generic; only the domain tables (profiles/exercises/workouts/…)
  are REPutation-specific.
- **`auth/`** — `compositeAuthProvider` (local + Supabase), `AuthContext`, and
  `backend/supabaseClient.ts` are generic.
- **`platform/`** — deepLinks, files, haptics, native, notify, statusBar: 100% generic.
- **`components/`** — Button, Card, BottomSheet, Toast, DragList, SwipeableRow,
  **ProgressRing** (perfect for budget rings), PillSelect, FilterSheet, AccentPicker.
- **AI coach pattern** — `features/coach/` splits cleanly into a reusable *shell*
  (chat UI, provider interface, edge-function client, offline mock scaffold) and a
  domain *contract* (summary builder + tools + prompts). Existing edge functions:
  `supabase/functions/coach`, `supabase/functions/delete-account`.
- **`lib/`** — cn, dates, palette, theme, useColorScheme, serviceWorker, version are
  generic; `units.ts` is weight/length (a finance app adds a sibling `money.ts`).

This maps almost 1:1 onto Part 6 of the existing modularization plan, which already
sketched the package graph `core → persistence → sync → platform → ui → app`.
This project is the reason to actually execute that split.

## 3. Monorepo layout

Convert the single `workout-tracker` package into an npm/pnpm-workspaces monorepo.
Only `apps/*` emit a `dist/`; each app has its own Capacitor config, Xcode project,
bundle ID, and Fastlane lane (reusing the `release:ios` pattern verbatim).

```
repo/
  packages/
    core/          # cn, dates, money, palette, theme, useColorScheme, version, serviceWorker
    local-first/   # Dexie scaffolding (outbox/deadLetter/syncState + syncStamp/touch/enqueue),
                   # generic SyncEngine (schema-driven), SyncBackend + Supabase impl, columnCase
    auth/          # compositeAuthProvider, local + supabase providers, AuthContext, supabaseClient
    platform/      # Capacitor wrappers: deepLinks, files, haptics, native, notify, statusBar
    ui/            # component kit + Tailwind preset
    ai-coach/      # chat shell, CoachProvider interface, edge-fn client, mock scaffold
  apps/
    rep/           # today's REPutation: domain, db schema, data repo, features (workout/insights/…)
    ledger/        # NEW: finance domain, db schema, data repo, features
  supabase/
    functions/     # coach (shared), delete-account, + plaid-link-token, plaid-exchange, plaid-webhook
    migrations/    # rep_* and ledger_* schemas (or separate projects — see §8)
```

Each app owns exactly what's domain-specific: `domain/` (types), `db/` (Dexie schema
+ seed), `data/` (repository), `features/`. Everything else is a workspace dependency.
Tooling steps (from the plan's Part 6): workspaces + per-package `tsconfig` project
references, replace the single `@/*`→`./src` alias with scoped names (`@tracker-engine/core`…),
keep one `dist/` per app so Vercel + Capacitor stay pointed at one output.

## 4. The one refactor that unlocks reuse: schema-driven sync

Generalize `SyncEngine` so its four workout-specific functions become a descriptor
the app passes in. The engine body barely changes.

```ts
// packages/local-first/schema.ts
export interface SyncSchema {
  /** Tables in dependency order (parents first) — was SYNCED_TABLES. */
  tables: readonly string[]
  /** The row this one hangs off, or undefined if top-level — was parentRowId(). */
  parentOf(table: string, row: Record<string, unknown>): { table: string; id: string } | undefined
  /** Backfill fields a pulled row can't carry — was normalizeRow(). Optional. */
  normalize?(table: string, row: Record<string, unknown>): Record<string, unknown>
  /** Dexie store accessor — was tableStore(). */
  store(table: string): { put(r: object): Promise<unknown>; get(id: string): Promise<object | undefined> }
  /**
   * NEW for finance: tables the SERVER authors. The drain never pushes these;
   * pull applies them. User edits to server rows live in a separate overlay table
   * (see §6), so the "server wins unless local pending" rule still holds cleanly.
   */
  serverAuthored?: readonly string[]
}
```

`drain()` skips `serverAuthored` tables; `pull()` is unchanged. REPutation supplies a
descriptor whose behavior is identical to today's hardcoded version — verified by the
existing sync tests passing unmodified.

## 5. Account aggregation (the new capability)

**Provider: Plaid** (broad US/CA/UK/EU bank coverage, transactions + balances +
investments, free sandbox/dev tier). Pluggable behind an interface so Teller (cheaper
for personal use) or MX can be swapped. Cost is the main tradeoff — flag for decision (§11).

Access tokens **must never reach the client**. The flow is server-mediated via Supabase
Edge Functions:

```
Client                     Edge Function                Plaid            DB (service role)
  │  request link_token ───▶ plaid-link-token ──────────▶ /link/token/create
  │  ◀── link_token ─────────┘
  │  open Plaid Link (Capacitor plugin / OAuth webview)
  │  ── user authenticates with bank ──▶ Plaid ── public_token ──▶ Client
  │  send public_token ────▶ plaid-exchange ────────────▶ /item/public_token/exchange
  │                              │  access_token + item_id ─────────▶ plaid_items (RLS: NO client read)
  │  ◀── ok (item linked) ───────┘
  │
  Plaid ── webhook SYNC_UPDATES_AVAILABLE ──▶ plaid-webhook
                                    │  verify webhook JWT, then /transactions/sync (cursor)
                                    │  upsert normalized rows ──────▶ accounts, transactions, balances
  │  next sync pull (existing engine, delta on updated_at) ◀────────── server-authored rows
```

Key properties:
- **access_token lives only in `plaid_items`** — RLS grants *no* select to `authenticated`;
  only the service role (edge functions) reads it. Encrypt the column (pgcrypto / Supabase Vault)
  so a DB dump doesn't leak it.
- **Ingestion is server-side**, driven by Plaid's `/transactions/sync` cursor and triggered
  by webhooks — the client never calls Plaid directly and never polls.
- **The client just pulls** `accounts` / `transactions` / `balances` through the existing
  sync engine, marked `serverAuthored`.
- **`delete-account` / erase path also calls Plaid `/item/remove`** to revoke the connection
  server-side (not just delete rows) — otherwise Plaid keeps access and billing.

## 6. Domain model

**Server-authored (pull-only):**
- `institutions` — id, name, logo, plaid_institution_id
- `accounts` — id, institution_id, name, mask, type (`depository|credit|loan|investment`),
  subtype, currency, current_balance, available_balance, is_active
- `transactions` — id, account_id, **amount** (signed; **convention: outflow negative**,
  documented once, enforced at ingest), date, name, merchant_name, plaid_category[],
  pending, payment_channel, location, iso_currency
- `balances` — daily snapshot per account (for net-worth-over-time)
- `holdings` / `securities` — investments (phase 5)

**Client-authored (push, as REPutation does today):**
- `categories` — id, name, group (`income|spending|transfer`), parent_id, icon, color, is_system
  (system defaults seeded like the exercise seed)
- `transaction_overrides` — **overlay**, keyed by transaction_id: category_id, note, tags[],
  is_hidden, `split[]` ({category_id, amount}), reviewed. **Never mutate a Plaid row** — merge
  the overlay at read time. This makes re-import idempotent and non-destructive (mirrors "server
  wins unless local pending"; avoids the classic "re-sync clobbered my categorization" bug).
- `manual_transactions` — cash / unlinked accounts
- `rules` — match (merchant regex / plaid_category / amount range) → category_id; auto-apply to new txns
- `budgets` — category-or-group, period (monthly), amount, rollover
- `goals` — savings goals: name, target, target_date, linked_account_id
- `recurring` — *derived cache* of detected subscriptions/bills (merchant, cadence, avg_amount,
  next_expected) — recomputed per device like `personalRecords`, not synced
- `coachConversations` — local-only, exactly as today

Every table carries `syncStamp()` fields and RLS `user_id = auth.uid()`.

## 7. Insights, graphs & pattern analysis

Reuse the `features/insights/` architecture (`useInsightsData` + ECharts chart modules)
and **`ProgressRing`** for budgets.

**One canonical calc layer — non-negotiable.** The workout app just spent a whole plan
(reactive-rolling-mountain) fixing divergent implementations of "the same number" (coach
volume vs. Home volume). Do it right from day one here: a single `apps/ledger/lib/money.ts`
+ metrics module defines *monthly category spend*, *cash flow*, *net worth*, *savings rate*
once, and the coach summary, insights charts, and budgets all call it. Enforce with the
existing `scripts/check-architecture.mjs` (ban inline money math outside the metrics module).

**Screens (graphs):**
- **Overview** — net worth (Σ balances), this-month in-vs-out, spend-vs-budget ring, top categories.
- **Spending** — category donut (month) + stacked bars (trailing months); drill category → merchants → txns.
- **Cash flow** — income vs expense bars + net line; **Sankey** (income → categories), which ECharts supports.
- **Net worth** — area chart from `balances` snapshots; stacked by account type.
- **Trends** — category MoM lines, savings rate over time, "biggest movers."
- **Budgets** — per-category burndown + projected overspend.

**Pattern analysis (the "analyze my patterns", non-AI):**
- **Recurring/subscription detection** — cluster by normalized merchant + near-constant amount
  + regular cadence → surface subscriptions, flag price hikes ("Netflix went $15→$18").
- **Anomaly detection** — category spend > k·(trailing median) → "Dining is 2.3× your usual."
- **Cash-flow forecast** — project month-end from recurring + trailing burn rate.
- **Duplicate/likely-fraud** — same merchant+amount within a short window.

## 8. AI coach (reuse `@tracker-engine/ai-coach`)

Same pattern as REPutation: Gemini edge function + offline data-driven mock provider.
The app supplies three things against the shared `CoachProvider` contract:

- **Summary builder** (like `getCoachSummary`) — compact JSON: 30/90-day spend by category,
  income, cash flow, savings rate, top merchants, MoM deltas, detected recurring, budget status,
  upcoming bills, net-worth trend. **Send the summary + tool results, never raw transaction dumps;
  redact account numbers.**
- **Tools** (like `coach/tools.ts`) — `getSpendingByCategory(range)`, `getMerchantHistory(m)`,
  `getRecurring()`, `getBudgetStatus()`, `getCashflow(range)`, `getAnomalies()`, `forecastMonthEnd()`.
- **Prompts / demo** — "Where can I cut back?", "What subscriptions am I paying for?",
  "Am I on track this month?", "What was that $240 charge?", "**Build me a budget from my last
  3 months**" → then *iterate* on it — reusing the exact template-iteration demo the workout coach
  landed (refine, don't restart).

## 9. Security & privacy (financial data raises the bar)

> ARCC was not queried (MCP server unavailable this session), so standard practices are applied
> explicitly. Financial aggregation is higher-stakes than fitness data — treat accordingly.

- **Plaid access tokens never touch the client.** `plaid_items.access_token` is service-role-only
  (no `authenticated` select policy), column-encrypted. `PLAID_SECRET` lives in Supabase secrets,
  never in the client bundle, never committed — same discipline as the existing `**/*.p8` /
  gitignored `.env`.
- **RLS on every table** (`user_id = auth.uid()`).
- **Verify Plaid webhook JWTs** (`Plaid-Verification` header against `/webhook_verification_key/get`)
  before trusting any payload.
- **PII minimization** — store masked account numbers only; never full PANs.
- **Local at-rest** — IndexedDB isn't encrypted, but on native the app sandbox is encrypted at rest
  when the device is locked. Add an **app-level biometric lock** (Capacitor FaceID/TouchID) gating
  balance reveal.
- **Erase path** revokes the Plaid item server-side (§5), not just deletes rows.
- **Compliance** — aggregating third-party financial data implicates Plaid's ToS and GLBA-adjacent
  expectations. Not legal advice; flag before production.

## 10. Phasing

- **Phase 0 — Monorepo split.** Extract shared packages from the rep app; generalize `SyncEngine`
  via `SyncSchema`. Rep app keeps shipping. **Done when:** rep builds (`build` + `build:native`),
  `vitest` green, `npm run lint` (architecture checker) green, `release:ios` unchanged.
- **Phase 1 — Ledger skeleton.** Auth + sync + Dexie schema + RLS + system category seed + manual
  transactions + a spending donut. Fully offline/local-first, no aggregation yet (proves the reuse).
- **Phase 2 — Aggregation.** Plaid Link (Capacitor) + 3 edge functions + webhook ingestion +
  server-authored accounts/transactions/balances pull + overlay editing.
- **Phase 3 — Insights + budgets + recurring detection** (canonical money metrics layer).
- **Phase 4 — AI coach** (summary + tools + mock + edge fn).
- **Phase 5 — Investments/holdings, goals, multi-currency, biometric lock, App Store** (new bundle
  ID + Fastlane lane cloned from rep).

## 11. Decisions to make

1. **Aggregation provider** — Plaid (best coverage, per-item cost in production) vs. Teller (cheaper
   for personal use, US-focused) vs. manual-import-only MVP (CSV/OFX, zero cost, no live sync).
   *Recommendation:* start Phase 1–3 with manual + CSV import (free, proves the app), add Plaid in
   Phase 2 once the shell is real.
2. **Supabase: one project or two?** Separate projects (clean RLS/quota isolation, simplest) vs. one
   project with `rep_`/`ledger_` schemas (shared auth/users). *Recommendation:* separate projects.
3. **How much monorepo now** — full 7-package split (Phase 0) vs. a lighter "extract `local-first` +
   `ui` only" first cut. *Recommendation:* full split — the architecture checker already enforces the
   boundaries, so the split is mostly mechanical file moves.
4. **Brand/name.**

## 13. Build & CI/CD (as simple as possible)

The guiding principle: **no build step between packages, and no orchestration tool until
build times hurt.**

- **npm workspaces, resolve-to-source.** Each package's `package.json` `exports` points
  straight at its TypeScript source (`"./src/index.ts"`), so consuming apps compile it
  through their own Vite/tsc — there's no separate "build the library" step, no stale
  `dist/`, no watch-mode dance. `npm install` symlinks packages into `node_modules/@tracker-engine/*`.
- **No Turborepo/Nx yet.** At two apps + a handful of packages, running the whole gauntlet
  on every change is faster than the machinery to compute "what's affected." Add caching /
  affected-only builds when CI runtime becomes annoying — it's a drop-in later, not a rewrite.
- **One CI workflow** (`.github/workflows/ci.yml`): `npm ci` → typecheck app → typecheck
  packages (`npm run typecheck --workspaces --if-present`) → architecture lint → tests →
  web build → native build. Single job, runs on push to `main` and every PR.
- **Release stays per-app and manual.** `npm run release:ios` (Fastlane → TestFlight) is
  unchanged for REPutation; Ledger gets its own lane + bundle ID cloned from it. Optionally
  wire a tag-triggered release workflow (`rep-v*`, `ledger-v*`) later — deliberately out of CI.
- **Deploy (Vercel) unchanged.** The rep app still builds at repo root (`npm run build` → `dist`).
  When the app eventually moves to `apps/rep/`, point Vercel's Root Directory at it (or update
  `buildCommand`/`outputDirectory`) — a one-setting change, flagged so it isn't a surprise.
- **Package-manager note:** staying on npm (not pnpm) keeps the existing `package-lock.json`
  and `npm ci` flow. pnpm would be marginally faster/stricter but isn't worth a migration here.

## 14. Proof of concept — DONE (2026-08-24)

A first, low-blast-radius slice landed on `main`'s working tree to de-risk the two hardest
unknowns before committing to the full split. **The shipping rep app is behaviorally identical.**

- **Workspace + first package.** Converted the repo to npm workspaces and extracted
  `packages/core` (`@tracker-engine/core`): `cn` (moved; `src/lib/cn.ts` is now a one-line re-export
  shim so no importer changed) plus a new `money.ts` (integer-minor-unit money primitives the
  Ledger app needs). Proves the whole toolchain — tsc, Vitest, Vite web build, and Vite native
  build all resolve and bundle a workspace package from source.
- **Schema-driven sync engine.** The four functions that hardcoded "workout" in `sync/engine.ts`
  (`SYNCED_TABLES`, `parentRowId`, `normalizeRow`, `tableStore`, plus the erase order) now come
  from a `SyncSchema` (`sync/schema.ts`); REPutation supplies `sync/repSchema.ts`. The engine
  constructor takes the schema with `repSyncSchema` as default, so all 35 existing call sites and
  tests are untouched. Added `serverAuthored` (drain skips those tables) for the finance
  pull-only model. A new `test/sync/schema.test.ts` runs the engine against a *non-workout* toy
  schema, proving genericity.
- **`@tracker-engine/local-first` extracted.** The whole sync layer — `SyncEngine`, `SyncBackend` +
  Supabase impl, `columnCase`, `syncLog`, and the outbox/dead-letter/sync-state types + stamps
  (`syncStamp`/`touch`/`isReadyToPush`) — moved into `packages/local-first`. The engine now has
  **zero app imports**: persistence and app services (`db` tables, `enqueue`, `reportError`) arrive
  as an injected `SyncDeps`, built app-side in `sync/deps.ts`. The app keeps thin re-export shims at
  `sync/{backend,schema,columnCase,supabaseBackend}.ts` and a `SyncEngine` subclass in `sync/engine.ts`
  that binds `repSyncSchema` + `appSyncDeps()`, so all 35 call sites, `db/database.ts` importers, and
  tests are unchanged. `db/database.ts` re-exports the scaffolding from the package.
- **CI.** Added `.github/workflows/ci.yml` (the gauntlet above) and a `typecheck:packages` script.
- **Verified (after each extraction):** app typecheck ✓, both package typechecks ✓, architecture
  lint ✓, **436 tests pass** (430 existing + 6 new; all 43 sync tests green), web build ✓, native build ✓.

**Remaining mechanical steps for the full split (each behavior-preserving, do behind green CI):**
move the rest of `lib` → `@tracker-engine/core`; make `TIMESTAMP_COLUMNS` injectable per-app (it's still
REPutation-flavored) and rename the outbox `deferredForWorkoutId` → `deferredFor` (needs a Dexie
index bump); extract `@tracker-engine/auth`, `@tracker-engine/platform`, `@tracker-engine/ui`, `@tracker-engine/ai-coach`; then relocate
the app into `apps/rep/` and point Vercel's root dir at it.

## 12. Risks

- **Not purely local-first anymore** — server is authoritative for institution data. The engine
  handles it (`serverAuthored`), but it's a genuine model shift to hold in mind.
- **Plaid Capacitor plugin maturity / OAuth redirect handling** on iOS.
- **Aggregation cost** at production scale (see §11).
- **Splitting a shipping app** (REPutation is in App Store review) is real risk — Phase 0 must leave
  the rep build and release pipeline byte-for-byte behavioral. Do it behind green tests + the
  architecture linter before touching anything else.
</content>
</invoke>
