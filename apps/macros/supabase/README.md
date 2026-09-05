# MACROcosm — Supabase

Project ref: **not created yet.** Nothing here is deployed.

## What you need to set up

1. `supabase projects create macros --region us-east-1`
2. Apply `migrations/0001_schema.sql` then `0002_rls.sql`.
3. Auth redirect URLs: `http://localhost:5175/**` and `macros://auth-callback`.
4. Secrets:
   - `USDA_API_KEY` — free from https://api.data.gov/signup (used by the `foods` function).
   - `GEMINI_API_KEY` — for the coach and photo logging, once those exist.
5. `supabase functions deploy foods`.

**Deploy every function before debugging client code.** REPutation's `delete-account` went
undeployed for months and 404'd silently.

## Without any of this

The app is fully usable: seeded foods, logging, weigh-ins, targets and check-ins all run
against IndexedDB. Barcode lookup still works too, because Open Food Facts needs no key and
the client calls it directly. What's missing is cross-device sync and USDA's ~2M branded rows.

## Authorship

`foods` is server-authored: everyone may `select`, nobody may write, and the `foods` function
is the only writer (service role bypasses RLS). Everything else is client-authored and owned
via `user_id = auth.uid()`.
