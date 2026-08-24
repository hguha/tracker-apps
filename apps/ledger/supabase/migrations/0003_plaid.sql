-- Plaid item storage. The access_token is a bearer credential for the user's bank
-- data, so it lives ONLY here, server-side: RLS is enabled with NO policies, meaning
-- no client (anon/authenticated) can read or write it — only the service role, which
-- the Plaid Edge Functions use, bypasses RLS. This is the token-never-touches-the-
-- client boundary (principle #8).

create table plaid_items (
  item_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null,
  institution text,
  cursor text, -- transactions/sync pagination cursor
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plaid_items enable row level security;
-- Intentionally no policies: deny all to clients; service role bypasses RLS.

create index plaid_items_owner on plaid_items (user_id);
