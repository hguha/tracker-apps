# Ledger backend (Supabase)

A **separate** Supabase project from REPutation — its own database, auth users, and
secrets. The app reuses the *same auth infrastructure* (`@tracker-engine/auth`, email
OTP) pointed at this project via `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

The app is fully usable with **no** backend (local device book + seeded bank feed).
Configuring the project turns on cross-device sync, the live coach, and Plaid.

## Layout

```
supabase/
├── config.toml                  project ref + per-function verify_jwt
├── migrations/
│   ├── 0001_schema.sql          domain tables, ownership (user_id default auth.uid()), triggers
│   ├── 0002_rls.sql             RLS: client-authored full; bank feed read-only (service-role writes)
│   └── 0003_plaid.sql           plaid_items (access_token; deny-all RLS, service-role only)
└── functions/
    ├── coach/                   finance coach (Gemini, chat + tools) — GEMINI_API_KEY
    ├── delete-account/          service-role account delete (cascades)
    ├── plaid-link-token/        Plaid Link step 1
    ├── plaid-exchange/          Plaid Link step 2 (stores access_token server-side)
    └── plaid-sync/              pulls accounts + transactions into the bank-feed tables
```

## One-time setup (CLI)

```bash
# From apps/ledger. Create the project (separate from reputation):
supabase projects create ledger --org-id <ORG_ID> --region <REGION> --db-password <STRONG_PW>

# Link this folder to it (writes project_id into config.toml):
supabase link --project-ref <NEW_REF>

# Push schema + RLS, deploy functions:
supabase db push
supabase functions deploy coach delete-account plaid-link-token plaid-exchange plaid-sync
```

Then set the app env (`apps/ledger/.env`, git-ignored):

```
VITE_SUPABASE_URL=https://<NEW_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from the dashboard>
```

**Auth redirect URLs** (dashboard → Authentication → URL Configuration): add the web
origin (e.g. `http://localhost:5174`, and the deployed URL) and the native scheme
`ledger://auth-callback`.

## Secrets (server-side only — never in the client bundle)

```bash
supabase secrets set GEMINI_API_KEY=...          # finance coach

# Teller (recommended aggregator — free for up to 100 connections). PEM from the
# Teller dashboard (Application → Certificates):
supabase secrets set TELLER_CERT="$(cat certificate.pem)"
supabase secrets set TELLER_KEY="$(cat private_key.pem)"

# Plaid (alternative; no free production tier — pay per call/account):
supabase secrets set PLAID_CLIENT_ID=...
supabase secrets set PLAID_SECRET=...
supabase secrets set PLAID_ENV=sandbox           # sandbox | development | production
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions automatically.

## Bank connections — Teller (recommended) or Plaid

Aggregation is server-mediated: the bank token never touches the app. The client opens
the provider's Connect widget, the token is stored server-side, and a sync function
fills the pull-only `accounts`/`transactions` tables — which the client pulls normally.

### Teller (recommended — genuinely free for personal use)

Free for **up to 100 live connections** ($0 until you exceed that). US banks; auth is a
client certificate + Teller Connect.

What I need from you:
1. **A Teller account** — sign up at teller.io (free). Create an Application.
2. **A client certificate** — Teller dashboard → your Application → Certificates:
   download `certificate.pem` + `private_key.pem`. Set them as `TELLER_CERT` / `TELLER_KEY`
   secrets (see above). Sandbox test tokens work without a cert.
3. **The Teller Application ID** — I'll use it to open Teller Connect in the app.

Then `teller-store-enrollment` saves the enrollment token and `teller-sync` pulls the data.

### Plaid (alternative — no free production tier)

Plaid sandbox is free (fake data), but **production is pay-as-you-go from the first
account** (Balance ~$0.10/call, Transactions ~$0.30/account/mo) — no perpetual free
tier. Use it only if you need coverage Teller lacks. Set `PLAID_CLIENT_ID`/`PLAID_SECRET`/
`PLAID_ENV`; scaffold requests `transactions` for `US`/`en`.

Until an aggregator is wired, the app runs on the seeded demo feed (`src/sync/mockData.ts`).
