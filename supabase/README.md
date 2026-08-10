# Backend (Supabase) — Phase 5

The front end runs fully against IndexedDB with **no backend attached** (the
prototype default). Attaching Supabase turns on sync without any structural
change to the app — the repository already queues every write to the outbox, and
the sync engine (`src/sync/`) drains it and pulls deltas behind the
`SyncBackend` interface (spec §5.5, §5.6).

## What's here

```
migrations/
  0001_schema.sql       Full schema, mirrors src/domain/types.ts 1:1 (§4)
  0002_triggers.sql     Server-clock updated_at, rebuild_prs(), profile hook (the
                        invite hook it also created was dropped by 0010)
  0003_rls.sql          Row-Level Security on every table (§4.13)
  0004_seed_library.sql System library: 27 muscles, 156 exercises, 27 metrics (user_id null)
  0005_fix_auth_trigger_search_path.sql
                        Pins search_path on the SECURITY DEFINER auth triggers.
                        REQUIRED — without it every signup fails with
                        "Database error saving new user".
  0006_split_arms_region.sql        'arms' → 'biceps' + 'triceps' regions
  0007_weekly_workout_goal.sql      profiles.weekly_workout_goal (Home ring)
  0008_show_avatar.sql              profiles.show_avatar (Home avatar opt-in)
  0009_template_progression.sql     template_exercises.progression (JSONB)
  0010_open_signup_and_profile_coaching.sql
                        Drops the invite-only trigger (open signup) and adds
                        profiles.height_cm + profiles.training_goal (coach inputs)
  0011_onboarded_at.sql             profiles.onboarded_at (first-run setup, per account)
  0012_drop_unused_tables.sql       Drops allowed_emails + the two unused push tables
tests/
  rls.test.sql          Asserts user A cannot read/write user B's rows (§4.13)
```

**Signup is open** (as of 0010): any valid email creates an account. Earlier
builds gated it on an `allowed_emails` table via the `enforce_invite_only`
trigger; 0010 dropped the trigger and 0012 dropped the table.

> **Applying newer migrations matters for sync.** A push of a row with a column
> the remote schema lacks (e.g. `weekly_workout_goal`, `training_goal`,
> `progression`) is classified *permanent* and **dead-lettered silently** — it
> shows as "Failed to sync" in the app's Data card. If templates/profile changes
> aren't syncing, confirm every migration is applied: `supabase db push`.

## Bring a project up

1. Create a free Supabase project (2-active-project limit; §2).
2. Apply migrations in order:
   ```bash
   supabase db push          # or: psql "$DATABASE_URL" -f migrations/0001_schema.sql ...
   ```
3. Run the RLS suite — **do not skip this**, RLS failures are silent (§4.13):
   ```bash
   supabase test db
   ```
4. Seed the shared library under the service role (system rows have
   `user_id is null` and are never written through the API — §4.13). The same
   seed data lives in `src/db/seed/`; export it to SQL or insert via a
   service-role script.
5. Point the client at the project by setting build-time env:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   With these present, `AuthContext` selects `SupabaseAuthProvider` and `useSync`
   attaches `SupabaseBackend` automatically. Without them, the app stays
   local-only. The anon key is public by design — RLS is what protects data.

## Magic-link redirects (the "it goes to localhost" fix)

The client pins the redirect to the *running* origin
(`window.location.origin + BASE_URL`, see `supabaseAuthProvider.ts`). But
Supabase only honors a redirect that matches its **Redirect URLs** allowlist —
otherwise it silently falls back to the dashboard **Site URL**. If a link opens
`localhost` from the deployed app, the deployed origin isn't allowlisted. Fix in
**Authentication → URL Configuration**:

- **Site URL**: the production origin (e.g. `https://fitnote.vercel.app`).
- **Redirect URLs**: add every origin the app is served from, each with the base
  path and a wildcard, e.g.
  `https://fitnote.vercel.app/**`, `http://localhost:5173/**`.

## The AI coach Edge Function

Deploy it and set its secret (the Gemini key lives ONLY here, never in the app
bundle):

```bash
supabase functions deploy coach --project-ref <ref>
supabase secrets set GEMINI_API_KEY=<key> --project-ref <ref>
```

Redeploy after changing `functions/coach/index.ts`. The client sends the
de-identified summary + request; without a signed-in JWT the function returns
401 and the app falls back to the offline coach.

## Still to wire (later in Phase 5/6)

- The initial **bootstrap pull** with a determinate progress bar (§5.5). The
  delta pull is implemented; bootstrap is the same call with `since = 0` plus UI.
- `keep_alive` RPC + Cloudflare cron every 3 days (§5.4).
- `delete-account` Edge Function (needs service role; §11.1.2).
- Weekly R2 backup and web-push scheduling (Phases 6–7).
