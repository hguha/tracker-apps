# tracker-apps

*A family of local-first apps built on one shared engine.*

This is the home for everything: the shared foundation, each app, each marketing site, and
the design notes that tie them together. The apps are deliberately small and focused — a
workout tracker, an expense tracker, maybe a calorie tracker. What they share is the
**engine**: the local-first sync engine, auth, platform wrappers, UI kit, and AI-coach pattern
that every one of these apps needs and none of them should reinvent.

This README is the handbook — the shared philosophy and the hard-won notes. Each app has its
own README for what's specific to it.

## Repository layout (today: one monorepo)

Right now everything lives in this one repo (`tracker-apps`) so the engine can churn cheaply
against its consumers. Each app *will* graduate to its own repo consuming a published engine —
see [`docs/architecture.md`](docs/architecture.md) for the monorepo→polyrepo plan and its trigger.

```
tracker-apps/
├── packages/                  npm workspaces — the shared engine
│   ├── core/            @tracker-engine/core         cn, money
│   └── local-first/     @tracker-engine/local-first  sync engine + Supabase backend
├── apps/                      npm workspaces — the products (consume the engine)
│   ├── reputation/      REPutation — workout tracker (the shipping app)
│   └── ledger/          Expense tracker demo (runs on the engine)
├── sites/                     marketing sites — self-contained (own node_modules)
│   └── reputation-site/ Astro static site → reputation.fitness
├── docs/                cross-cutting design (architecture, decisions)
└── README.md            this handbook
```

`packages/*` and `apps/*` are npm workspaces (they share the root `node_modules` and consume
the engine by symlink). Marketing sites under `sites/*` are kept **self-contained** — each has
its own `node_modules`/lockfile — because their toolchain (Astro, a different TypeScript major)
is independent and shares nothing with the apps.

Common tasks from the repo root: `npm run dev` (REPutation) · `npm run dev:ledger` ·
`npm run dev:site` / `build:site` (marketing site) · `npm test` / `npm run typecheck` (all
workspaces) · `npm run build` / `build:native` / `release:ios` (REPutation).

## The family (and where each piece lives today)

Everything is in **this one monorepo** right now. The "own repo" column is the *future*
polyrepo endgame (see `docs/architecture.md`), not today.

| Piece | What it is | Lives today | Eventual repo |
|---|---|---|---|
| engine (`@tracker-engine/*`) | The shared packages | `packages/core`, `packages/local-first` | `tracker-engine` |
| **reputation** | Workout tracker (REPutation) — the shipping app | `apps/reputation/` | `reputation` |
| **ledger** | Expense tracker (demo, runs on the engine) | `apps/ledger/` | `ledger` |
| reputation-site | REPutation's marketing site (Astro → reputation.fitness) | `sites/reputation-site/` | `reputation-site` |
| ledger-site, calorie, … | future | — | — |

Each app owns only what's genuinely its own — domain model, database schema, screens, native
shell (Capacitor + iOS/Android + Fastlane), and Vercel/PWA deploy. Everything mechanical comes
from the engine.

## The engine (`@tracker-engine/*`)

The reusable foundation lives in the `tracker-engine` repo and is published as a scope of
packages. Each depends only *downward*, and an app grabs a specific one — e.g.
`import { SyncEngine } from '@tracker-engine/local-first'`.

| Package | Responsibility | Status |
|---|---|---|
| `@tracker-engine/core` | Pure primitives: `cn`, `money`, dates, units, palette, theme | started (`cn`, `money`) |
| `@tracker-engine/local-first` | Sync engine (outbox drain, delta pull, dead-letter, retry), `SyncBackend` + Supabase impl, Dexie scaffolding — driven by an injected `SyncSchema` + `SyncDeps`, zero app imports | **done** |
| `@tracker-engine/auth` | Provider interface + local + Supabase providers, composite "works-signed-out" flow | planned |
| `@tracker-engine/platform` | Capacitor wrappers: haptics, files, notify, status bar, native shell | **done** |
| `@tracker-engine/ui` | Component kit: Button, Card, BottomSheet, ProgressRing, Toast, DragList … | planned |
| `@tracker-engine/ai-coach` | Chat shell + `CoachProvider` interface + offline mock; app supplies summary + tools | planned |

> Note on the scope: `@tracker-engine` is the *namespace*, not a package — you always import a
> specific one (`@tracker-engine/core`, `@tracker-engine/local-first`, …). Keeping them separate
> is what lets each be versioned and depended on independently.

An app builds itself by writing a domain, a DB schema, and features on top of these — for
sync, it hands the engine a `SyncSchema` (what to sync) and `SyncDeps` (where it lives). See
`docs/architecture.md` for how the engine is consumed and how repos relate over time.

## Shared design philosophy

These principles hold across every app. They're why the shared engine is possible.

1. **Local-first, offline-authoritative.** IndexedDB (Dexie) is the source of truth; the UI
   never awaits the network. Sync reconciles in the background against Supabase. The app is
   fully usable signed out, on a plane, forever.

2. **One canonical representation, one conversion boundary.** Store one canonical unit
   (kilograms for lifting, integer minor units for money) and convert *only* at the display
   edge. Storing display units pushes conversion into every chart and comparison, where one
   miss silently corrupts a year of data.

3. **One data-access boundary.** Nothing but the `data/` layer touches the database. Screens
   call a repository. That single seam is what keeps the sync layer swappable.

4. **Layered, and enforced.** `domain → lib → db → data → sync/auth → components → features →
   app`, dependencies point only downward. A tiny checker (`scripts/check-architecture.mjs`,
   not ESLint — TS 7 isn't supported yet) fails the build on an upward import.

5. **Auth is one seam.** Nothing above `auth/types` knows how auth works; screens call
   `useAuth()`. A composite provider means the app works signed out, and signing in *claims*
   the device's local data rather than discarding it.

6. **Sync is a contract, not a feature.** Backend-agnostic (`SyncBackend`), domain-agnostic
   (`SyncSchema`), app-agnostic (`SyncDeps`). Outbox drains parents-before-children, delta
   pull on open/foreground (never a timer), poison writes dead-letter with retry, and there's
   always a discard-local and a hard-erase escape hatch. Server-authored (pull-only) tables
   handle data the client doesn't own (e.g. bank transactions).

7. **Calc-consistency.** Every quantity is computed one way, in one place. "Weekly volume" or
   "monthly spend" must be identical in the coach, the charts, and the budgets — divergent
   implementations of the same number are a bug class we've been burned by and now lint for.

8. **Privacy by default.** AI summaries are de-identified — no names, notes, or absolute dates
   leave the device. Errors go to a first-party log (no third-party SDK). Financial data
   raises the bar further: third-party tokens live server-side only, RLS on every table,
   column encryption, biometric lock.

9. **AI is an optional, swappable provider.** One `CoachProvider` interface, two
   implementations: an edge-function model (Gemini) when signed in, and a data-driven offline
   **mock** so the feature works — and demos — with no network and no key.

10. **One build, native shell.** The iOS/Android apps are the *same web build* wrapped in
    Capacitor — no second codebase. PWA and native ship from one bundle. Releases are one
    command (Fastlane → TestFlight).

11. **Comments minimal.** The code reads on its own; rename or reorganize rather than
    annotate. Comment only a non-obvious *why* — a workaround, an invariant, an ordering
    constraint — never a *what*. Most functions have none.

12. **Ship-quality plumbing is table stakes.** Service worker + `storage.persist()`, a
    keep-alive cron against the free-tier idle timer, a scrubbed error log, and a real privacy
    policy — every app gets these, so they belong in the shared patterns, not reinvented.

## How the repos relate

Short version: **monorepo now, polyrepo later.** Today the engine + REPutation live together so
the engine can churn cheaply against its first consumer. When the second app (Ledger) arrives it
joins as a second workspace — still one repo, still no publish step — which is what battle-tests
the engine's API. Only once the engine stabilizes and the repo-count actually hurts do we split
each app into its own repo consuming a **published, versioned** engine (GitHub Packages +
Changesets). The full rationale, consumption mechanics, and migration sequence are in
[`docs/architecture.md`](docs/architecture.md).

## Conventions when working in any repo

- **Verify before declaring done:** `typecheck`, `test`, `lint` (architecture), `build`, and
  `build:native` all green. The test suite is the safety net for every refactor.
- **Behavior-preserving refactors stay behavior-preserving** — prove it with the existing
  tests before adding anything new.
- **Secrets never commit.** API keys (`**/*.p8`), `.env` with IDs, third-party tokens — all
  git-ignored; tokens for account aggregation live server-side only.
- **Don't "finish" rebrands of load-bearing identifiers.** Some internal IDs (OAuth schemes,
  storage keys, bundle IDs, backup format fields) are deliberately kept on old names.

## Where the deep design lives

- [`docs/architecture.md`](docs/architecture.md) — the org: engine, monorepo→polyrepo, consumption, migration.
- `reputation/workout-app-spec.md` — the exhaustive product spec the `§`-numbered code comments cite.
- `reputation/docs/design-expense-tracker.md` — the Ledger design + the engine split (will migrate here once `tracker-engine` is its own repo).
- Each app/site README — what's specific to that one.
