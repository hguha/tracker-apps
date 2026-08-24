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
# Plaid (see below):
supabase secrets set PLAID_CLIENT_ID=...
supabase secrets set PLAID_SECRET=...
supabase secrets set PLAID_ENV=sandbox           # sandbox | development | production
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions automatically.

## What I need from you for Plaid

Bank connectivity is server-mediated (the Plaid token never touches the app). To turn
the scaffold on:

1. **A Plaid account** — sign up at dashboard.plaid.com (free). Sandbox is instant;
   Development/Production require Plaid's review.
2. **API keys** — from the Plaid dashboard (Team Settings → Keys): `client_id` and the
   **Sandbox** `secret`. Set them as the Supabase secrets above with `PLAID_ENV=sandbox`.
3. **Products / scopes** — this scaffold requests `transactions` for `US`/`en`. Tell me
   if you want `auth`, `investments`, or more country codes and I'll widen the Link token.
4. **Redirect URI** (only needed for OAuth banks / production): register an
   `https://…/plaid-oauth` redirect in the Plaid dashboard and I'll pass it to Link.

With sandbox keys set, "Connect a bank" in Settings opens Plaid Link, `plaid-exchange`
stores the token, and `plaid-sync` fills the bank-feed tables — which the client pulls
through the normal sync path (those tables are server-authored / pull-only).

Until then, the app runs on the seeded demo feed (`src/sync/mockData.ts`).
