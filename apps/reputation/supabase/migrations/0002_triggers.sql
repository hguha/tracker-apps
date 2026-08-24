-- Server-clock updated_at (§4.11)
--
-- updated_at is maintained from the *server* clock on every write, never trusted
-- from the client — a device with a wrong clock must not be able to win a
-- last-write-wins comparison it shouldn't. The client still sends client_rev,
-- which is what LWW actually compares; updated_at is the tiebreaker and the
-- delta-pull cursor.

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
  synced_tables text[] := array[
    'profiles', 'muscles', 'exercises', 'workouts', 'workout_exercises',
    'sets', 'templates', 'template_exercises', 'personal_records',
    'metric_definitions', 'metric_entries'
  ];
begin
  foreach t in array synced_tables loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function touch_updated_at()',
      t, t
    );
  end loop;
end;
$$;

-- rebuild_prs(user_id) (§4.8)
--
-- Recomputes every personal record for a user from scratch. Idempotent, so a
-- sync hiccup can never leave PRs permanently wrong — the client computes PRs
-- optimistically for instant feedback, and this is the authoritative rebuild.
-- e1RM uses Epley capped at 12 reps (§8.1), matching lib/metrics.ts exactly.

create or replace function rebuild_prs(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  delete from personal_records where user_id = p_user_id;

  insert into personal_records (id, user_id, exercise_id, record_type, value, achieved_at, set_id, client_rev)
  with logged as (
    select
      we.exercise_id,
      s.id as set_id,
      w.started_at as at,
      s.weight_kg,
      s.reps,
      s.duration_seconds,
      s.distance_m
    from sets s
    join workout_exercises we on we.id = s.workout_exercise_id
    join workouts w on w.id = we.workout_id
    where w.user_id = p_user_id
      and w.deleted_at is null
      and we.deleted_at is null
      and s.deleted_at is null
      and s.is_completed
      and s.set_type <> 'warmup'
  ),
  candidates as (
    select exercise_id, 'max_weight'::record_type as record_type, weight_kg as value, at, set_id
      from logged where weight_kg is not null and weight_kg > 0
    union all
    select exercise_id, 'max_reps_any_weight', reps, at, set_id
      from logged where reps is not null and reps > 0
    union all
    select exercise_id, 'max_est_1rm',
      weight_kg * (1 + reps / 30.0), at, set_id
      from logged where weight_kg is not null and weight_kg > 0
        and reps between 1 and 12
    union all
    select exercise_id, 'max_duration', duration_seconds, at, set_id
      from logged where duration_seconds is not null and duration_seconds > 0
    union all
    select exercise_id, 'max_distance', distance_m, at, set_id
      from logged where distance_m is not null and distance_m > 0
  ),
  ranked as (
    select
      exercise_id, record_type, value, at, set_id,
      row_number() over (
        partition by exercise_id, record_type
        order by value desc, at asc
      ) as rn
    from candidates
  )
  select
    exercise_id || ':' || record_type,
    p_user_id,
    exercise_id,
    record_type,
    value,
    at,
    set_id,
    1
  from ranked
  where rn = 1;
end;
$$;

-- Invite-only signup (§4.13)
--
-- Rejects any signup whose email is not in allowed_emails. Wired as an auth
-- hook; managed by direct SQL. A stranger with a valid magic link still can't
-- create an account.

create or replace function enforce_invite_only()
returns trigger
language plpgsql
security definer
as $$
begin
  if not exists (select 1 from allowed_emails where email = lower(new.email)) then
    raise exception 'This email is not on the invite list.';
  end if;
  return new;
end;
$$;

create trigger enforce_invite_only_trigger
  before insert on auth.users
  for each row execute function enforce_invite_only();

-- A profile row per new user (§11.1.3). The system library is shared; the
-- profile is per-user, created here so the app always has one to read.
create or replace function create_profile_for_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger create_profile_trigger
  after insert on auth.users
  for each row execute function create_profile_for_user();
