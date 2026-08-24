-- Row-Level Security (§4.13)
--
-- RLS on every table. RLS failures are silent and total, so the accompanying
-- test suite (§4.13, supabase/tests/rls.test.sql) asserts per table that user A
-- cannot read or write user B's rows. Do not weaken a policy without updating
-- that suite.
--
-- Three shapes:
--   1. Direct ownership     — `user_id = auth.uid()`.
--   2. Chained ownership    — no own user_id; walk to the owning workout.
--   3. Shared library       — read open (system + own), write own only.

alter table profiles enable row level security;
alter table muscles enable row level security;
alter table exercises enable row level security;
alter table exercise_secondary_muscles enable row level security;
alter table workouts enable row level security;
alter table workout_exercises enable row level security;
alter table sets enable row level security;
alter table templates enable row level security;
alter table template_exercises enable row level security;
alter table personal_records enable row level security;
alter table metric_definitions enable row level security;
alter table metric_entries enable row level security;
alter table push_subscriptions enable row level security;
alter table scheduled_notifications enable row level security;
alter table allowed_emails enable row level security;

-- 1. Direct-ownership tables --------------------------------------------------

create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create policy "own workouts" on workouts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own templates" on templates for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own personal_records" on personal_records for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own metric_entries" on metric_entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own push_subscriptions" on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own scheduled_notifications" on scheduled_notifications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Chained-ownership tables -------------------------------------------------
-- These have no user_id; ownership is proven by walking to the workout.

create policy "own workout_exercises" on workout_exercises for all
  using (
    exists (
      select 1 from workouts w
      where w.id = workout_exercises.workout_id and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from workouts w
      where w.id = workout_exercises.workout_id and w.user_id = auth.uid()
    )
  );

create policy "own sets" on sets for all
  using (
    exists (
      select 1 from workout_exercises we
      join workouts w on w.id = we.workout_id
      where we.id = sets.workout_exercise_id and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from workout_exercises we
      join workouts w on w.id = we.workout_id
      where we.id = sets.workout_exercise_id and w.user_id = auth.uid()
    )
  );

create policy "own template_exercises" on template_exercises for all
  using (
    exists (
      select 1 from templates t
      where t.id = template_exercises.template_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from templates t
      where t.id = template_exercises.template_id and t.user_id = auth.uid()
    )
  );

create policy "own exercise_secondary_muscles" on exercise_secondary_muscles for all
  using (
    exists (
      select 1 from exercises e
      where e.id = exercise_secondary_muscles.exercise_id
        and (e.user_id = auth.uid() or e.user_id is null)
    )
  )
  with check (
    exists (
      select 1 from exercises e
      where e.id = exercise_secondary_muscles.exercise_id and e.user_id = auth.uid()
    )
  );

-- 3. Shared library tables — read system + own, write own only ---------------

create policy "read system + own muscles" on muscles for select
  using (user_id is null or user_id = auth.uid());
create policy "insert own muscles" on muscles for insert
  with check (user_id = auth.uid());
create policy "update own muscles" on muscles for update
  using (user_id = auth.uid());
create policy "delete own muscles" on muscles for delete
  using (user_id = auth.uid());

create policy "read system + own exercises" on exercises for select
  using (user_id is null or user_id = auth.uid());
create policy "insert own exercises" on exercises for insert
  with check (user_id = auth.uid());
create policy "update own exercises" on exercises for update
  using (user_id = auth.uid());
create policy "delete own exercises" on exercises for delete
  using (user_id = auth.uid());

create policy "read system + own metric_definitions" on metric_definitions for select
  using (user_id is null or user_id = auth.uid());
create policy "insert own metric_definitions" on metric_definitions for insert
  with check (user_id = auth.uid());
create policy "update own metric_definitions" on metric_definitions for update
  using (user_id = auth.uid());
create policy "delete own metric_definitions" on metric_definitions for delete
  using (user_id = auth.uid());

-- allowed_emails: no client access at all. Managed by service role / direct SQL.
-- With RLS on and no policy, every client read and write is denied by default.
