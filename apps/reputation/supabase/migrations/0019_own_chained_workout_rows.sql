-- Give workout_exercises and sets their own owner column, so RLS is a statement
-- about the row rather than about its ancestors existing.
--
-- Both policies were an EXISTS join up to workouts.user_id. Postgres evaluates a
-- WITH CHECK before the FK fires, so a set whose parent row hadn't reached the
-- server yet came back as `42501 new row violates row-level security policy for
-- table "sets"` — a permanent rejection the client dead-letters — when the real
-- problem was ordering, which retrying fixes. One rejected parent therefore
-- turned into a permanent pile of "sets RLS" failures.
--
-- With ownership denormalized, a missing parent surfaces as 23503
-- (foreign_key_violation), which the client treats as transient and retries in
-- order, and 42501 goes back to meaning what it says: someone else's row.
--
-- The column is server-managed: `default auth.uid()` fills it, so the client
-- never sends it and no client change is needed to populate it. A soft-delete or
-- an upsert of an existing row leaves it untouched (it isn't in the payload, so
-- it isn't in the ON CONFLICT DO UPDATE SET list).

alter table workout_exercises add column user_id uuid references auth.users(id) on delete cascade;
alter table sets add column user_id uuid references auth.users(id) on delete cascade;

update workout_exercises we set user_id = w.user_id
  from workouts w where w.id = we.workout_id;

update sets s set user_id = w.user_id
  from workout_exercises we join workouts w on w.id = we.workout_id
 where we.id = s.workout_exercise_id;

-- Prove the backfill was total before the column carries the policy.
do $$
begin
  if exists (select 1 from workout_exercises where user_id is null) then
    raise exception 'workout_exercises.user_id null for % row(s); aborting',
      (select count(*) from workout_exercises where user_id is null);
  end if;
  if exists (select 1 from sets where user_id is null) then
    raise exception 'sets.user_id null for % row(s); aborting',
      (select count(*) from sets where user_id is null);
  end if;
end
$$;

alter table workout_exercises alter column user_id set not null;
alter table workout_exercises alter column user_id set default auth.uid();
alter table sets alter column user_id set not null;
alter table sets alter column user_id set default auth.uid();

create index workout_exercises_user on workout_exercises (user_id);
create index sets_user on sets (user_id);

drop policy "own workout_exercises" on workout_exercises;
drop policy "own sets" on sets;

create policy "own workout_exercises" on workout_exercises for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own sets" on sets for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
