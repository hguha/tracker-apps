# COINcidence — roadmap

**Status: deferred (2026-09-04).** Parked after Phase 1.5, not abandoned. The reason is
external and unlikely to change: **no aggregator offers a free tier for US personal
accounts.** Plaid, Teller and Stripe Financial Connections were all checked — Teller's
advertised free tier is gated and inaccessible; Plaid and Stripe bill from the first
account (~$0.10/balance, ~$0.30/txns per account/month). Without free bank linking the app
can only be as good as its CSV/OFX import, which works but is manual, so the remaining
phases aren't worth building yet.

What is already done still works and is worth keeping alive: local-first app on the shared
engine, rules + AI categorization, CSV/OFX import, budgets, subscription detection, net
worth. Resume if an aggregator opens a free tier, or if paying a few dollars a month
becomes acceptable — the seam is `src/sync/aggregation.ts` plus the `plaid-*` / `teller-*`
edge functions, and nothing else needs to change.

## Aggregator decision (updated: no free live API exists)

Checked Teller, Plaid, Stripe Financial Connections — **none offer a free tier for US
personal use** anymore (Teller advertises 100 free connections but access is gated;
Plaid + Stripe are pay-as-you-go from the first account: ~$0.10 balance / $0.30 txns
per account/mo). So the **free primary path is CSV/OFX statement import** (done) —
works with any bank, $0, no aggregator account. Live auto-sync via Plaid/Stripe stays
scaffolded server-side as an optional pay-as-you-go add-on (pennies/month for one
person). Everything sits behind one seam: `src/sync/aggregation.ts` + the `teller-*` /
`plaid-*` edge functions; imported rows become client-authored manual entries.

## Done (foundation)

- Local-first app on the shared engine: Overview, Log, History, Insights, Settings, Coach.
- Two authorship classes (client-authored vs server-authored bank feed) + override overlay.
- Canonical metrics; budgets; subscription detection; net worth; offline + live coach.
- Supabase project + RLS + functions (coach, delete-account, plaid-*, teller-*).

## Phases (each independently shippable, all free)

### Phase 1 — Rules + auto-categorization ✅ DONE
- `Rule` model (client-authored, synced); pure `lib/rules.ts`; `repo.applyRules()` runs
  after every sync + on edits (bank txns via synced overrides, manual entries in place).
- Settings → Rules screen.
- **AI categorization** ✅: `categorize` Edge Function (Gemini) maps uncategorized
  merchants → categories; the client turns them into rules ("Auto-categorize with AI").

### Phase 1.5 — Free data in ✅ DONE
- **CSV/OFX import** (`lib/import.ts` + Settings → Import): parse any bank export,
  dedupe, create client-authored entries, auto-categorize. The free path in.

### Phase 2 — Full financial picture
- **Manual accounts** (cash, property, vehicles, loans, crypto) so net worth is complete.
- **Net-worth-over-time**: nightly balance snapshots (`account_snapshots`) via `pg_cron`
  → a net-worth trend chart.
- **Goals**: savings targets with progress + projected completion date.

### Phase 3 — Alerts engine (`pg_cron` → push)
- Web push subscription + a scheduled edge function that runs daily and emits:
  bill/subscription due, low balance, unusual spend (anomaly vs. category baseline),
  subscription price-hike. First-party, no third-party SDK.

### Phase 4 — AI copilot upgrade (Era-class)
- **Cash-flow forecast**: project month-end balance from recurring + scheduled items.
- **What-if** scenarios ("if I cut dining 20%…").
- **Weekly digest**: a proactive nudge summarizing the week + one suggested action.
- **Natural-language search** ("coffee since June") backed by the metrics layer.

### Phase 5 — Breadth
- **Investments/holdings** (Plaid investments) — positions + value in net worth.
- **Reports** — monthly statement, category trends, year-in-review.
- **Multi-currency** display.
- **Live sync** (optional): wire Plaid/Stripe pay-as-you-go for hands-off import.

## Not doing (can't be free / not replicable)
- Bill *negotiation* (Rocket Money uses humans). Closest: AI drafts a cancellation email.
- Autosave / moving money (ACH funding — regulated, paid).
- Credit score (needs a bureau partnership).

## Free-tier watchpoints
- Supabase free: 500MB DB, pauses after 7 days idle → keep-alive cron (as REPutation has).
- Gemini free: rate-limited; the coach already degrades to the offline mock.
- Teller free: 100 connections — plenty for personal use.
