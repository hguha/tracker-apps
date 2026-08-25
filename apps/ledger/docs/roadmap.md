# COINcidence — roadmap to Monarch / Era / Rocket Money parity

Goal: match the *tracking + budgeting + AI-copilot* value of Monarch, Era, and Rocket
Money, on our free stack (Supabase free tier: DB + auth + edge functions + `pg_cron`;
Gemini free tier; Teller free tier; heavy compute is client-side). Money-movement and
human-concierge features are deliberately out of scope (see "Not doing").

Internal name stays `ledger` (workspace, dir, Dexie store `ledger`, storage key
`ledger.auth`, scheme `ledger://`, Supabase project `ledger` / ref `viqnylegpdfuqkcbhizb`)
— the same way REPutation keeps `fitnote` internally. The brand everywhere user-facing
is **COINcidence**.

## Aggregator decision

**Teller** is the primary aggregator: free for up to 100 live connections (US banks,
client-cert + Teller Connect). **Plaid** stays as an alternative but has *no free
production tier* (pay-as-you-go from the first account). Both are wired server-side
(token never touches the client); the client only pulls the resulting server-authored
rows. **CSV/OFX import** is the always-free fallback (Phase 5). The choice lives behind
one seam: `src/sync/aggregation.ts` + the `teller-*` / `plaid-*` edge functions.

## Done (foundation)

- Local-first app on the shared engine: Overview, Log, History, Insights, Settings, Coach.
- Two authorship classes (client-authored vs server-authored bank feed) + override overlay.
- Canonical metrics; budgets; subscription detection; net worth; offline + live coach.
- Supabase project + RLS + functions (coach, delete-account, plaid-*, teller-*).

## Phases (each independently shippable, all free)

### Phase 1 — Rules + auto-categorization *(foundation for everything)*
- `Rule` model (client-authored): match on merchant (contains/equals/regex) → category.
- Pure `lib/rules.ts` (`categoryOf(entry, rules)`), applied when new bank txns arrive
  (writes a synced override) and previewable in History.
- Settings → Rules screen (list/add/edit); "always categorize X as Y" from a txn.
- **AI categorization**: a `categorize` edge-function mode that maps a batch of
  uncategorized merchants → category ids (Gemini), plus "turn this into a rule".

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
- **Investments/holdings** (Teller/Plaid investments) — positions + value in net worth.
- **CSV/OFX import** — always-free ingestion; maps to the same server/manual model.
- **Reports** — monthly statement, category trends, year-in-review.
- **Multi-currency** display.

## Not doing (can't be free / not replicable)
- Bill *negotiation* (Rocket Money uses humans). Closest: AI drafts a cancellation email.
- Autosave / moving money (ACH funding — regulated, paid).
- Credit score (needs a bureau partnership).

## Free-tier watchpoints
- Supabase free: 500MB DB, pauses after 7 days idle → keep-alive cron (as REPutation has).
- Gemini free: rate-limited; the coach already degrades to the offline mock.
- Teller free: 100 connections — plenty for personal use.
