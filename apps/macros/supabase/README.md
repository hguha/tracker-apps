# MACROcosm — Supabase

Project ref: **not created yet.** Nothing here is deployed.

## What you need to set up

1. `supabase projects create macros --region us-east-1`
2. Apply `migrations/0001_schema.sql` then `0002_rls.sql`.
3. Auth redirect URLs: `http://localhost:5175/**` and `macros://auth-callback`.
4. Secrets:
   - `USDA_API_KEY` — free from https://api.data.gov/signup (used by the `foods` function).
   - `GEMINI_API_KEY` — free from https://aistudio.google.com/apikey (used by `coach`).
5. `supabase functions deploy foods coach`.

**Deploy every function before debugging client code.** REPutation's `delete-account` went
undeployed for months and 404'd silently.

## Without any of this

The app is fully usable: seeded foods, logging, weigh-ins, targets and check-ins all run
against IndexedDB, and the **offline coach** answers from the same repository the live one's
tools read. Barcode lookup works too, because Open Food Facts needs no key and the client calls
it directly. What's missing is cross-device sync, USDA's ~2M branded rows, and conversational
coaching.

`config.toml` sets `verify_jwt = false` for `foods` on purpose: a device-only user holds the
anon key but no session, and food lookup has to work for them. `coach` keeps JWT verification,
so a device-only user gets the offline coach instead.

## Authorship

`foods` is server-authored: everyone may `select`, nobody may write, and the `foods` function
is the only writer (service role bypasses RLS). Everything else is client-authored and owned
via `user_id = auth.uid()`.
