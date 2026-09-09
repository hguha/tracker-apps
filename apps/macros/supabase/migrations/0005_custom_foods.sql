-- Foods the user entered themselves, from a label no database has.
--
-- A separate table from `foods` rather than user-owned rows in it: `foods` is server-authored
-- reference data that everyone may read and nobody may write, and relaxing that to allow
-- client inserts would let one account write a row another account's history reads. This table
-- is ordinary owned data, with the same policy shape as every other client-authored table.
create table if not exists custom_foods (
  id            text primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  source        text not null default 'custom',
  description   text not null,
  brand         text,
  barcode       text,
  category      text,
  data_type     text,
  -- Per 100 g, integer milligrams, exactly like `foods`.
  per100        jsonb not null,
  grams_per_ml  numeric,
  portions      jsonb not null default '[]'::jsonb,
  verified_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  client_rev    integer not null default 1
);

create index if not exists custom_foods_user_updated on custom_foods (user_id, updated_at);

alter table custom_foods enable row level security;

create policy "own custom_foods" on custom_foods for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
