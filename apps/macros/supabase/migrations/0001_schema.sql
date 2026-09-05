-- MACROcosm — schema.
--
-- Nutrients are integer milligrams and integer kcal, held in jsonb, for the same reason
-- REPutation stores kg and COINcidence stores minor units: a day's total must equal the sum
-- of its rows. Every table mirrors src/domain/types.ts one-to-one (camelCase <-> snake_case
-- at the sync boundary), so rows move between IndexedDB and Postgres without translation.
--
-- Ownership: user_id defaults to auth.uid(), so a client upsert never sends an owner. On
-- delete of the auth user, every owned row cascades.
--
-- Authorship (see src/sync/macroSchema.ts):
--   * log_entries / body_weights / recipes / meal_templates / programs / check_ins
--     — client-authored (RLS full ownership).
--   * foods — server-authored reference data: everyone reads, only the `foods` edge
--     function (service role) writes.

create or replace function set_row_timestamps()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Server-authored reference data. No user_id: foods are global, not owned.
create table foods (
  id            text primary key,
  source        text not null check (source in ('usda', 'off', 'custom')),
  description   text not null default '',
  brand         text,
  barcode       text,
  category      text,
  data_type     text,
  per100        jsonb not null,
  grams_per_ml  numeric,
  portions      jsonb not null default '[]',
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  client_rev    integer not null default 1
);
create index foods_barcode_idx on foods (barcode) where barcode is not null;
create index foods_search_idx on foods
  using gin (to_tsvector('english', description || ' ' || coalesce(brand, '')));

-- Client-authored -------------------------------------------------------------------

-- One row per user, keyed BY the user id: appearance, units and the cold-start facts follow
-- the account, and `onboarding_version` is here (not device-local) so setup doesn't re-run on
-- a second device.
create table profiles (
  id                 uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name       text not null default 'You',
  units              text not null default 'metric',
  theme              text not null default 'default',
  color_scheme       text not null default 'system',
  accent_override    text,
  height_cm          numeric,
  birth_year         integer,
  sex                text,
  onboarded_at       timestamptz,
  onboarding_version integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  client_rev         integer not null default 1
);

create table log_entries (
  id            text primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day           text not null,
  eaten_at      timestamptz not null default now(),
  meal          text not null default 'snack',
  sort_index    bigint not null default 0,
  food_id       text,
  recipe_id     text,
  quick_add     jsonb,
  grams         numeric not null default 0,
  portion_id    text,
  portion_count numeric,
  nutrients     jsonb not null,
  source        text not null default 'search',
  estimate      jsonb,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  client_rev    integer not null default 1,
  -- Exactly one subject: a food, a recipe, or ad-hoc macros.
  constraint one_subject check (
    (food_id is not null)::int + (recipe_id is not null)::int + (quick_add is not null)::int = 1
  )
);
create index log_entries_day_idx on log_entries (user_id, day) where deleted_at is null;

create table body_weights (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day        text not null,
  kg         numeric not null,
  source     text not null default 'macros',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1,
  -- One weigh-in per day, so the trend can't be skewed by weighing twice.
  unique (user_id, day)
);

create table recipes (
  id           text primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null default '',
  servings     integer not null default 1,
  yield_grams  numeric,
  ingredients  jsonb not null default '[]',
  steps        jsonb not null default '[]',
  tags         jsonb not null default '[]',
  source_url   text,
  authored_by  text not null default 'user',
  nutrients    jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  client_rev   integer not null default 1
);

create table meal_templates (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null default '',
  items      jsonb not null default '[]',
  nutrients  jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

create table programs (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal              text not null default 'maintain',
  rate_pct_per_week numeric not null default 0,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  coaching_mode     text not null default 'coached',
  protein_g_per_kg  numeric not null default 1.8,
  fat_min_pct_kcal  numeric not null default 25,
  cycling           jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  client_rev        integer not null default 1
);

-- Immutable audit trail of every weekly recalculation. `kcal_per_kg` is stored so changing
-- the constant later cannot rewrite what a past week concluded.
create table check_ins (
  id                       text primary key,
  user_id                  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start               text not null,
  expenditure_kcal         numeric not null,
  expenditure_se           numeric not null,
  trend_kg                 numeric not null,
  trend_change_kg_per_week numeric not null,
  mean_intake_kcal         numeric not null,
  days_logged              integer not null default 0,
  kcal_per_kg              numeric not null,
  targets                  jsonb not null,
  status                   text not null default 'proposed',
  note                     text not null default '',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  client_rev               integer not null default 1,
  unique (user_id, week_start)
);

do $$
declare t text;
begin
  foreach t in array array['foods', 'profiles', 'log_entries', 'body_weights', 'recipes',
                           'meal_templates', 'programs', 'check_ins']
  loop
    execute format(
      'create trigger %I_timestamps before insert or update on %I
         for each row execute function set_row_timestamps()', t, t);
  end loop;
end $$;
