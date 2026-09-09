# MACROcosm — Supabase

Project ref: **kofgokucenxojecqbyhr** (`macros`, us-east-1). Schema, RLS, secrets and both
functions are live.

## What's configured

- Migrations `0001`–`0004` applied (`0003` diet notes, `0004` eating window).
- Secrets: `USDA_API_KEY`, `GEMINI_API_KEY`.
- Functions: `foods` (verify_jwt **off**), `coach` and `delete-account` (verify_jwt **on**).
- `coach` serves three modes: `chat` (tool loop), `estimate` (a described meal) and `photo`
  (an image). All three return names and grams only — the client computes every nutrient.
- `site_url` / redirect allow-list: `http://localhost:5175/**`, `macros://auth-callback`.
- `mailer_autoconfirm` off, `mailer_otp_length` 6 — same anti-spam posture as REPutation.

`verify_jwt` differs on purpose. Food lookup must work for a device-only user, who holds the
anon key and no session; the coach requires a session, so device-only gets the offline coach
instead.

## Demo account

`demo@macrocosm.app` — five weeks of logs, 26 weigh-ins and five check-ins, all synced. Re-seed
after a schema change:

```
npm run dev:macros
DEMO_EMAIL=demo@macrocosm.app DEMO_PASSWORD='…' node apps/macros/scripts/seed-demo.mjs
```

It drives the real app rather than inserting rows, which is the point: that's what caught the
timestamp, duplicate-id and expenditure bugs. Clear the account's rows first if you want a clean
run, or a legacy row can still own a (user, day) pair.

## Still outstanding

**SMTP is not configured**, so email goes through Supabase's built-in sender — team addresses
only, a couple per hour. Sign-up with confirmation required therefore won't work for an
arbitrary address yet. REPutation uses Resend (`smtp.resend.com:465`, user `resend`, sender
`noreply@hirshguha.com`); the same key would work here, but the Management API redacts it, so
it has to be supplied.

## Local dev

`apps/macros/.env` holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and is gitignored.
The anon key is public by design — RLS is what protects the data.

## Commands

```
supabase link --project-ref kofgokucenxojecqbyhr
supabase db push
supabase secrets set USDA_API_KEY=... GEMINI_API_KEY=...
supabase functions deploy foods coach delete-account
npm run test:e2e:live          # needs `npm run dev:macros` running
```

**Deploy every function before debugging client code.** REPutation's `delete-account` went
undeployed for months and 404'd silently, so it's verified here: deleting removed the auth user
and cascaded its rows away.

## Without any of this

The app stays fully usable: seeded foods, logging, weigh-ins, targets, check-ins, and the
offline coach all run against IndexedDB. Barcode lookup still works because Open Food Facts
needs no key and the client calls it directly.

## Authorship

`foods` is server-authored: everyone may `select`, nobody may write, and the `foods` function
(service role) is the only writer. Everything else is client-authored and owned via
`user_id = auth.uid()` — except `profiles`, whose primary key *is* the user id.
