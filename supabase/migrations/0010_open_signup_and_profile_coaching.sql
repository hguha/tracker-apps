-- Open signup + profile fields the coach personalizes against.
--
-- Two changes that ship together:
--
-- 1. OPEN SIGNUP (§4.13 relaxed). The app was invite-only: enforce_invite_only()
--    rejected any auth.users insert whose email wasn't in allowed_emails. Product
--    decision — anyone can now sign up. Drop the trigger and the function so a
--    valid magic link creates an account for any email. The allowed_emails table
--    is left in place (harmless, and the RLS test suite still references it); it
--    simply no longer gates signup.
--
-- 2. PROFILE COACHING FIELDS. The coach should factor in height and a stated
--    body/training goal (bodyweight already lives in bodyweight_cache_kg). Both
--    are optional and default to "unset" so existing rows need no backfill.

-- 1. Open signup ---------------------------------------------------------------
drop trigger if exists enforce_invite_only_trigger on auth.users;
drop function if exists enforce_invite_only();

-- 2. Profile coaching fields ---------------------------------------------------
alter table profiles
  add column if not exists height_cm numeric;

alter table profiles
  add column if not exists training_goal text not null default '';
