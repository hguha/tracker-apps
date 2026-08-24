-- Fix: auth.users triggers failed with "Database error saving new user".
--
-- The two functions are SECURITY DEFINER, which runs with an empty search_path,
-- so the unqualified names `allowed_emails` and `profiles` did not resolve —
-- Postgres raised "relation does not exist", and GoTrue reported every signup
-- (invited or not) as a generic 500. Two fixes, applied together:
--   1. Pin `search_path` to public (the Supabase-recommended hardening).
--   2. Schema-qualify the table references, so resolution never depends on it.
-- Also grant the auth admin role the access these definer functions rely on.

create or replace function enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowed_emails where email = lower(new.email)
  ) then
    raise exception 'This email is not on the invite list.';
  end if;
  return new;
end;
$$;

create or replace function create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The signup path executes as supabase_auth_admin. SECURITY DEFINER runs the
-- body as the owner (postgres), but make the intent explicit and robust.
grant usage on schema public to supabase_auth_admin;
grant select on public.allowed_emails to supabase_auth_admin;
grant insert on public.profiles to supabase_auth_admin;

-- rebuild_prs() has the same SECURITY DEFINER / empty-search_path exposure: it
-- would fail the moment it's called. Pin its search_path too. (The body already
-- qualifies nothing, but every table it touches lives in public, so this is
-- sufficient.)
alter function rebuild_prs(uuid) set search_path = public;
