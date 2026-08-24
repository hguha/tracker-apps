-- Row-Level Security. RLS on every table; failures are silent and total.
--
-- Two shapes:
--   1. Client-authored — full access to your own rows (user_id = auth.uid()).
--   2. Server-authored bank feed — you may SELECT your own rows, but only the Plaid
--      sync function (service role, which bypasses RLS) may write them. With no
--      insert/update/delete policy, those statements are denied for a normal user,
--      so a client can never forge a bank row.

alter table categories enable row level security;
alter table budgets enable row level security;
alter table entries enable row level security;
alter table category_overrides enable row level security;
alter table accounts enable row level security;
alter table transactions enable row level security;

-- 1. Client-authored: full ownership.
create policy "own categories" on categories for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own budgets" on budgets for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own entries" on entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own category_overrides" on category_overrides for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Server-authored bank feed: read-only for the owner; writes are service-role only.
create policy "read own accounts" on accounts for select
  using (user_id = auth.uid());
create policy "read own transactions" on transactions for select
  using (user_id = auth.uid());
