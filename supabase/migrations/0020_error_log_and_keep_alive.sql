-- A per-user error log the client writes into, and a pg_cron heartbeat that
-- keeps the free-tier DB from pausing at the 1-week idle mark (§2).

-- §11.4 forbids a third-party error SDK, so errors go here instead. INSERT-only:
-- the client posts a scrubbed row; there is no read policy, so developer reads
-- go through the service role. Rows cascade away with the account.
create table client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  app_version text not null,
  context text not null,
  message text not null,
  stack text,
  url text,
  user_agent text
);

create index client_errors_user_id_occurred_at_idx
  on client_errors (user_id, occurred_at desc);

alter table client_errors enable row level security;

create policy "insert own client_errors" on client_errors for insert
  with check (user_id = auth.uid());

-- The heartbeat. The daily pg_cron update covers "no DB activity"; a GH Actions
-- HTTP cron (DEPLOYING.md) covers "no API activity" — Supabase's idle policy
-- could mean either.
create extension if not exists pg_cron with schema extensions;

-- Single-row, updated in place, never client-touched, so it stays out of RLS.
create table keep_alive (
  id int primary key default 1 check (id = 1),
  beat_at timestamptz not null default now()
);
insert into keep_alive (id) values (1);
revoke all on table keep_alive from anon, authenticated;

select cron.schedule(
  'keep-alive-daily',
  '17 3 * * *',
  $$update public.keep_alive set beat_at = now() where id = 1$$
);
