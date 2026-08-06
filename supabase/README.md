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
  0002_triggers.sql     Server-clock updated_at, rebuild_prs(), invite hook, profile hook
  0003_rls.sql          Row-Level Security on every table (§4.13)
  0004_seed_library.sql System library: 27 muscles, 156 exercises, 27 metrics (user_id null)
  0005_fix_auth_trigger_search_path.sql
                        Pins search_path on the SECURITY DEFINER auth triggers.
                        REQUIRED — without it every signup fails with
                        "Database error saving new user".
tests/
  rls.test.sql          Asserts user A cannot read/write user B's rows (§4.13)
```

Invite-only signup is enforced by the `allowed_emails` table + `enforce_invite_only`
trigger (§4.13) — not Supabase's Auth-tab allowlist. To invite someone:

```sql
insert into allowed_emails (email) values ('you@example.com');
```

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
5. Add the invite list:
   ```sql
   insert into allowed_emails (email) values ('you@example.com');
   ```
6. Point the client at the project by setting build-time env:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   With these present, `AuthContext` selects `SupabaseAuthProvider` and `useSync`
   attaches `SupabaseBackend` automatically. Without them, the app stays
   local-only. The anon key is public by design — RLS is what protects data.

## Still to wire (later in Phase 5/6)

- The initial **bootstrap pull** with a determinate progress bar (§5.5). The
  delta pull is implemented; bootstrap is the same call with `since = 0` plus UI.
- `keep_alive` RPC + Cloudflare cron every 3 days (§5.4).
- `delete-account` Edge Function (needs service role; §11.1.2).
- Weekly R2 backup and web-push scheduling (Phases 6–7).
