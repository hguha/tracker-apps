-- Weekly workout goal, for the Home progress ring (§5.2.1).
--
-- The number of sessions per week the user is aiming for. Drives the "4/5 this
-- week" ring on Home. Defaulted to 4 so existing rows get a sensible target
-- without a backfill pass.

alter table profiles
  add column if not exists weekly_workout_goal int not null default 4;
