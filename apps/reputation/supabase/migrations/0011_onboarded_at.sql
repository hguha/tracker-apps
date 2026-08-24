-- Onboarding completion, on the profile so it follows the account.
--
-- It was tracked in the browser's localStorage, which is per-device: signing in
-- on a phone and then a laptop ran first-run setup twice. The profile is the
-- natural home — it's per-account and it already syncs.
--
-- Nullable rather than a boolean default false, so an existing account isn't
-- retroactively marked as having completed a flow it never saw; the client treats
-- "has a profile with real settings" as onboarded via the backfill below.

alter table profiles
  add column if not exists onboarded_at timestamptz;

-- Existing accounts have already been using the app, so don't send them through
-- setup. Anyone whose profile shows evidence of use is marked done.
update profiles
set onboarded_at = coalesce(onboarded_at, now())
where onboarded_at is null
  and (training_goal <> '' or height_cm is not null or display_name <> '');
