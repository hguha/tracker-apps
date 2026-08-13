-- Production-readiness plumbing: a per-user error log the app writes into,
-- and a small pg_cron heartbeat that keeps the free-tier DB from pausing at
-- the 1-week idle mark (§2 of the spec).
--
-- First-party only. §11.4 forbids a third-party error SDK because this app
-- holds health-adjacent data; instead we insert a scrubbed record into a table
-- the caller can INSERT to but CANNOT SELECT from — reads happen via the
-- service role from the dashboard. Users don't accumulate their own errors,
-- and the row deletes with the account (cascade on auth.users).

-- ── client_errors ───────────────────────────────────────────────────────────

create table client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  app_version text not null,
  -- 'error-boundary' | 'window-error' | 'unhandled-rejection' | free-form dev tag
  context text not null,
  message text not null,
  stack text,
  url text,
  user_agent text
);

create index client_errors_user_id_occurred_at_idx
  on client_errors (user_id, occurred_at desc);

alter table client_errors enable row level security;

-- INSERT own: the client stamps `user_id` to auth.uid() and posts. Nothing else.
create policy "insert own client_errors" on client_errors for insert
  with check (user_id = auth.uid());

-- No SELECT / UPDATE / DELETE policy — with RLS on and none granted, all three
-- are denied. Developer reads go through the service role in the dashboard.

-- ── keep_alive ──────────────────────────────────────────────────────────────
--
-- Supabase pauses inactive free-tier projects at 1 week. A daily heartbeat via
-- pg_cron produces DB activity even when nobody is using the app. This is the
-- belt; the suspenders is a GH Actions HTTP cron that hits the REST API — see
-- DEPLOYING.md for the workflow. The two together defend against both possible
-- interpretations of "inactive".

create extension if not exists pg_cron with schema extensions;

create table keep_alive (
  id int primary key default 1 check (id = 1),
  beat_at timestamptz not null default now()
);
insert into keep_alive (id) values (1);

-- Single-row: the cron job updates it in place, so the table never grows.
-- No RLS — the table is written only by the scheduled job (running as
-- supabase_admin) and never touched by the client. Left with RLS OFF and no
-- policy so a client SELECT still errors (RLS off + no grant = permission
-- denied for a signed-in caller); revoke defensively too.
revoke all on table keep_alive from anon, authenticated;

select cron.schedule(
  'keep-alive-daily',
  '17 3 * * *',
  $$update public.keep_alive set beat_at = now() where id = 1$$
);
