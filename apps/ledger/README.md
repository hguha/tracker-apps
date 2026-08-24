# Ledger

A local-first expense tracker, built on the shared `@tracker-engine/*` engine — the
same spine as REPutation, a different domain. IndexedDB is the source of truth; the UI
never awaits the network; Supabase reconciles in the background.

## What it does

- **Overview** — net worth, this month's income/spend/savings, top categories, recent
  activity, and a shortcut into the coach.
- **Log** — add a manual transaction (cash, splits, untracked accounts) from the center
  tab action; income/expense is a sign toggle.
- **History** — the full ledger, grouped by month, searchable, filterable by category.
  Tap a manual entry to edit it; tap a bank transaction to recategorize it.
- **Insights** — monthly cash flow, spend-by-category, budgets, and detected
  subscriptions (ECharts).
- **Settings** — bank accounts, categories & budgets, appearance (theme + light/dark),
  sync & data controls, sign-out/delete.
- **Coach** — a finance chat agent. Live via Gemini (an Edge Function holds the key) or
  a data-driven **offline mock**; it reads de-identified aggregates and can propose a
  budget as an interactive card.

## Architecture (shared with REPutation)

Layered `domain → lib → db → data → sync/auth → components → features → app`, enforced
by `scripts/check-architecture.mjs` (`npm run lint`). The engine is injected, never
imported into: sync runs on `@tracker-engine/local-first` driven by
[`src/sync/ledgerSchema.ts`](src/sync/ledgerSchema.ts) (what to sync) +
[`src/sync/deps.ts`](src/sync/deps.ts) (where it lives).

**Two authorship classes** (the interesting part):

- **Client-authored** — `entries` (manual log), `categories`, `budgets`,
  `categoryOverrides`. Created on-device, pushed to your own Supabase.
- **Server-authored** — `accounts`, `transactions`: the bank feed. The Plaid server
  (an Edge Function holding the token) writes them; the client only pulls them and can
  never forge one. Recategorizing a bank transaction writes a client-authored
  *override* keyed by its id, so it syncs without mutating the pull-only row.

Both flatten into one `LedgerEntry` read model ([`src/lib/entries.ts`](src/lib/entries.ts))
so every screen and metric works on one shape. All quantities come from the canonical
[`src/lib/metrics.ts`](src/lib/metrics.ts) (calc-consistency).

`profile` is intentionally device-local (not synced): a single `'me'` row would collide
across users on a shared table, so appearance is per-device for now.

## Bank data: mock now, Plaid drop-in

The app ships on a realistic **seeded** bank feed ([`src/sync/mockData.ts`](src/sync/mockData.ts))
served through the same `SyncBackend` the real backend uses, so pull/categorize/insights/
coach all run end to end with no network. The Plaid path is scaffolded — server functions
+ the client seam ([`src/sync/plaid.ts`](src/sync/plaid.ts)) — and turns on when you add
sandbox keys. See [`supabase/README.md`](supabase/README.md) for exactly what's needed.

## Run it

```bash
npm run dev:ledger        # from the repo root → http://localhost:5174
npm run build:ledger
```

No `.env` needed for local dev (runs on the mock + a device-only account). To enable
sync + the live coach, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` and follow
[`supabase/README.md`](supabase/README.md).

## Tests

- **Unit** (`test/`, vitest): metrics, the `toLedgerEntries` merge, the offline coach.
- **Integration**: `test/repository.test.ts` — the repository + Dexie + the shared
  engine (pull the seeded feed, then the client-write paths) — and `test/engine.test.ts`
  proving Ledger rides the shared engine (pushes client rows, never the bank tables).
- **E2E**: `../../e2e/ledger.spec.ts` (Playwright) — the real UI: sign-in, seeded sync,
  logging, insights, coach.

Run from the root: `npm test` (or `--workspace ledger`), `npm run test:e2e`.
