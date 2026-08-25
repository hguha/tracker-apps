-- Auto-categorization rules (client-authored, synced like categories/budgets).

create table rules (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant_match text not null default '',
  match_type text not null default 'contains' check (match_type in ('contains', 'equals')),
  category_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

create index rules_owner_updated on rules (user_id, updated_at);

create trigger t_rules_ts before insert or update on rules
  for each row execute function set_row_timestamps();

alter table rules enable row level security;
create policy "own rules" on rules for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
