create table if not exists client_errors (
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

create index if not exists client_errors_user_id_occurred_at_idx
  on client_errors (user_id, occurred_at desc);

alter table client_errors enable row level security;

create policy "insert own client_errors" on client_errors for insert
  to authenticated
  with check (user_id = (select auth.uid()));
