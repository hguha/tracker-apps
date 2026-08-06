-- RLS isolation test suite (spec §4.13, §11.2)
--
-- "RLS failures are silent and total." A missing or wrong policy doesn't error —
-- it silently leaks or hides data. So this asserts, per table, that user A can
-- neither read nor write user B's rows. Run with pgTAP:
--
--   supabase test db          # via the Supabase CLI
--   -- or --
--   psql -f supabase/tests/rls.test.sql
--
-- The pattern: create two users, insert data as each, then switch the request
-- role to user A (set request.jwt.claim.sub) and assert visibility.

begin;
select plan(14);

-- Seed two users directly (bypassing the invite hook, which we test separately).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

-- A muscle + exercise are shared system rows (null user_id). Library ids are
-- readable text slugs, not uuids (see 0001_schema.sql).
insert into muscles (id, user_id, name, region)
  values ('mid_chest', null, 'Mid Chest', 'chest');
insert into exercises (id, user_id, name, primary_muscle_id, equipment, movement_pattern)
  values ('bench', null, 'Bench', 'mid_chest', 'barbell', 'horizontal_push');

-- Each user logs a workout.
insert into workouts (id, user_id, started_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now()),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', now());

insert into templates (id, user_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'A Push'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'B Push');

-- Become user A.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- ---- Reads: A sees only A's rows -------------------------------------------

select is(
  (select count(*)::int from workouts),
  1,
  'A sees exactly one workout (its own), never B''s'
);

select is(
  (select count(*)::int from workouts where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot read B''s workouts even by explicit filter'
);

select is(
  (select count(*)::int from templates),
  1,
  'A sees only its own template'
);

-- Shared library: A sees the system exercise and muscle.
select is(
  (select count(*)::int from exercises where id = 'bench'),
  1,
  'A can read the shared system exercise'
);
select is(
  (select count(*)::int from muscles where id = 'mid_chest'),
  1,
  'A can read the shared system muscle'
);

-- ---- Writes: A cannot write into B's data ----------------------------------

select throws_ok(
  $$ insert into workouts (id, user_id, started_at)
     values ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', now()) $$,
  null,
  null,
  'A cannot insert a workout owned by B'
);

select throws_ok(
  $$ insert into templates (id, user_id, name)
     values ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'sneaky') $$,
  null,
  null,
  'A cannot insert a template owned by B'
);

-- Updating B's workout affects zero rows (invisible under RLS), never an error
-- that would reveal existence.
update workouts set title = 'hijacked'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from workouts where title = 'hijacked'),
  0,
  'A''s update of B''s workout matched no visible rows'
);

-- A can insert its own child rows (chained ownership) ...
insert into workout_exercises (id, workout_id, exercise_id, position)
  values ('aaaaaaaa-0000-0000-0000-000000000010',
          'aaaaaaaa-0000-0000-0000-000000000001',
          'bench', 0);
select is(
  (select count(*)::int from workout_exercises),
  1,
  'A can add an exercise to its own workout'
);

-- ... but not into B's workout.
select throws_ok(
  $$ insert into workout_exercises (id, workout_id, exercise_id, position)
     values ('cccccccc-0000-0000-0000-000000000010',
             'bbbbbbbb-0000-0000-0000-000000000001',
             'bench', 0) $$,
  null,
  null,
  'A cannot add an exercise to B''s workout (chained ownership)'
);

-- A cannot edit the shared system exercise (write-closed library).
update exercises set name = 'Hacked Bench'
  where id = 'bench';
select is(
  (select count(*)::int from exercises where name = 'Hacked Bench'),
  0,
  'A cannot modify a system exercise (library is write-closed)'
);

-- allowed_emails is invisible to clients entirely.
select is(
  (select count(*)::int from allowed_emails),
  0,
  'allowed_emails is not readable by an authenticated client'
);

-- Become user B; symmetric check that B sees only its own workout.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is(
  (select count(*)::int from workouts),
  1,
  'B sees exactly one workout (its own)'
);
select is(
  (select count(*)::int from workout_exercises),
  0,
  'B cannot see the exercise A added to A''s workout'
);

select finish();
rollback;
