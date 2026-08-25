-- Teller enrollment storage. Like plaid_items, the access_token is a bearer credential
-- for the user's bank data, so it lives ONLY here (RLS enabled, NO policies → deny-all
-- to clients; only the service role the Teller Edge Functions use bypasses RLS). This
-- is the token-never-touches-the-client boundary (principle #8).
--
-- Teller is the recommended aggregator: free for up to 100 live connections.

create table teller_enrollments (
  enrollment_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null,
  institution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table teller_enrollments enable row level security;
-- Intentionally no policies: deny all to clients; service role bypasses RLS.

create index teller_enrollments_owner on teller_enrollments (user_id);
