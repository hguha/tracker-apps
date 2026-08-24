-- Ledger — schema.
--
-- Money is stored in integer minor units (bigint), outflows negative. Every table
-- mirrors the TypeScript domain in src/domain/types.ts one-to-one (camelCase ↔
-- snake_case at the sync boundary), so row shapes move between IndexedDB and Postgres
-- without translation.
--
-- Ownership: `user_id` defaults to auth.uid(), so a client upsert that omits it gets
-- the caller as owner automatically — the client never sends a user_id. On delete of
-- the auth user, every owned row cascades.
--
-- Authorship (see src/sync/ledgerSchema.ts):
--   • categories / budgets / entries / category_overrides — client-authored (RLS full).
--   • accounts / transactions — server-authored bank feed: the client may only SELECT;
--     the Plaid sync function (service role) writes them.

-- Server clock owns created_at/updated_at, so a device with a wrong clock can't poison
-- delta-pull ordering.
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

-- Client-authored ------------------------------------------------------------------

create table categories (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  icon text not null default '🏷️',
  color text not null default 'var(--cat-uncategorized)',
  is_income boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

create table budgets (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id text not null,
  limit_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

create table entries (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id text,
  category_id text,
  amount_minor bigint not null default 0,
  currency text not null default 'USD',
  date text not null,
  merchant text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

-- Keyed by the transaction id it overrides (client-authored recategorization of a
-- server-authored bank row).
create table category_overrides (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

-- Server-authored bank feed --------------------------------------------------------

create table accounts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  institution text,
  mask text not null default '',
  type text not null default 'depository',
  current_balance_minor bigint not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

create table transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  category_id text,
  amount_minor bigint not null default 0,
  currency text not null default 'USD',
  date text not null,
  merchant text not null default '',
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1
);

-- Delta-pull reads `updated_at > since` per user; index it alongside the owner.
create index categories_owner_updated on categories (user_id, updated_at);
create index budgets_owner_updated on budgets (user_id, updated_at);
create index entries_owner_updated on entries (user_id, updated_at);
create index category_overrides_owner_updated on category_overrides (user_id, updated_at);
create index accounts_owner_updated on accounts (user_id, updated_at);
create index transactions_owner_updated on transactions (user_id, updated_at);

-- Server-clock timestamps on every table.
create trigger t_categories_ts before insert or update on categories
  for each row execute function set_row_timestamps();
create trigger t_budgets_ts before insert or update on budgets
  for each row execute function set_row_timestamps();
create trigger t_entries_ts before insert or update on entries
  for each row execute function set_row_timestamps();
create trigger t_category_overrides_ts before insert or update on category_overrides
  for each row execute function set_row_timestamps();
create trigger t_accounts_ts before insert or update on accounts
  for each row execute function set_row_timestamps();
create trigger t_transactions_ts before insert or update on transactions
  for each row execute function set_row_timestamps();
