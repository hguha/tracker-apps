-- Collapse the bodyweight tracking types into one + add a per-instance load mode,
-- and fold duplicate movements into their canonical base.
--
-- Before, a movement's bodyweight/weighted/assisted variants were three separate
-- tracking types (and, for assisted, separate exercises). Now a bodyweight
-- movement is a single `bodyweight_reps` type, and whether weight is added,
-- assisted off, or neither is `load_mode` on the workout/template exercise —
-- chosen the way `equipment` is. Volume then reads bodyweight×factor ± entered.
--
-- Client twins: src/data/exercises.ts migrateExerciseModel() (local repoint +
-- load-mode backfill), src/db/seed/bases.ts EXERCISE_MERGES, and the collapsed
-- TRACKING_TYPES / LoadMode in src/domain/types.ts. This migration covers rows a
-- device that never opens again would otherwise leave behind.

-- 1. The new dimension.
create type load_mode as enum ('bodyweight', 'weighted', 'assisted');

alter table workout_exercises add column load_mode load_mode;
alter table template_exercises add column load_mode load_mode;

-- 2. Backfill load_mode from the exercise's (still-old) tracking type, before
--    step 5 erases the distinction. Only bodyweight movements get a mode.
update workout_exercises we
   set load_mode = (case e.tracking_type
                      when 'weighted_bodyweight' then 'weighted'
                      when 'assisted_bodyweight' then 'assisted'
                      when 'bodyweight_reps' then 'bodyweight'
                    end)::load_mode,
       updated_at = now()
  from exercises e
 where e.id = we.exercise_id
   and e.tracking_type in ('weighted_bodyweight', 'assisted_bodyweight', 'bodyweight_reps');

update template_exercises te
   set load_mode = (case e.tracking_type
                      when 'weighted_bodyweight' then 'weighted'
                      when 'assisted_bodyweight' then 'assisted'
                      when 'bodyweight_reps' then 'bodyweight'
                    end)::load_mode,
       updated_at = now()
  from exercises e
 where e.id = te.exercise_id
   and e.tracking_type in ('weighted_bodyweight', 'assisted_bodyweight', 'bodyweight_reps');

-- 3. Repoint history off the merged-away duplicates. The four machine/dumbbell
--    presses keep their equipment; the assisted movements fold into a load mode
--    of the base and move to bodyweight equipment.
update workout_exercises set exercise_id = 'incline_bench_press', updated_at = now() where exercise_id = 'incline_press';
update workout_exercises set exercise_id = 'bench_press',         updated_at = now() where exercise_id = 'chest_press';
update workout_exercises set exercise_id = 'overhead_press',      updated_at = now() where exercise_id in ('shoulder_press', 'seated_shoulder_press');
update template_exercises set exercise_id = 'incline_bench_press', updated_at = now() where exercise_id = 'incline_press';
update template_exercises set exercise_id = 'bench_press',         updated_at = now() where exercise_id = 'chest_press';
update template_exercises set exercise_id = 'overhead_press',      updated_at = now() where exercise_id in ('shoulder_press', 'seated_shoulder_press');

update workout_exercises set exercise_id = 'dip',     equipment = 'bodyweight', load_mode = 'assisted', updated_at = now() where exercise_id = 'assisted_dip';
update workout_exercises set exercise_id = 'pull_up', equipment = 'bodyweight', load_mode = 'assisted', updated_at = now() where exercise_id = 'assisted_pull_up';
update template_exercises set exercise_id = 'dip',     equipment = 'bodyweight', load_mode = 'assisted', updated_at = now() where exercise_id = 'assisted_dip';
update template_exercises set exercise_id = 'pull_up', equipment = 'bodyweight', load_mode = 'assisted', updated_at = now() where exercise_id = 'assisted_pull_up';

-- 4. The canonical rows absorb the retired rows' aliases so search still finds
--    them ("incline press", "assisted dip"), then the retired system rows are
--    archived.
update exercises target
   set aliases = array(select distinct unnest(target.aliases || retired.aliases)),
       updated_at = now()
  from exercises retired
 where (retired.id = 'incline_press'         and target.id = 'incline_bench_press')
    or (retired.id = 'chest_press'           and target.id = 'bench_press')
    or (retired.id = 'shoulder_press'        and target.id = 'overhead_press')
    or (retired.id = 'seated_shoulder_press' and target.id = 'overhead_press')
    or (retired.id = 'assisted_dip'          and target.id = 'dip')
    or (retired.id = 'assisted_pull_up'      and target.id = 'pull_up');

update exercises set is_archived = true, updated_at = now()
 where id in ('incline_press', 'chest_press', 'shoulder_press', 'seated_shoulder_press',
              'assisted_dip', 'assisted_pull_up')
   and user_id is null;

-- 5. Coerce every exercise still on a retired bodyweight tracking type to the
--    single type, giving it a bodyweight factor if it lacked one.
update exercises
   set tracking_type = 'bodyweight_reps',
       bodyweight_factor = coalesce(bodyweight_factor, 1),
       updated_at = now()
 where tracking_type in ('weighted_bodyweight', 'assisted_bodyweight');

-- 6. Rebuild the tracking_type enum without the two retired values. add-column /
--    UPDATE / swap, not `alter type ... using` — see migrations/README.md and 0013.
create type tracking_type_v2 as enum
  ('weight_reps', 'bodyweight_reps', 'reps_only', 'time', 'distance_time', 'weight_time');

alter table exercises add column tracking_type_new tracking_type_v2;
update exercises set tracking_type_new = tracking_type::text::tracking_type_v2;

do $$
begin
  if exists (select 1 from exercises where tracking_type_new is null) then
    raise exception 'tracking_type_new is null for % row(s); aborting',
      (select count(*) from exercises where tracking_type_new is null);
  end if;
end $$;

alter table exercises drop column tracking_type;
alter table exercises rename column tracking_type_new to tracking_type;
alter table exercises alter column tracking_type set not null;
alter table exercises alter column tracking_type set default 'weight_reps';

drop type tracking_type;
alter type tracking_type_v2 rename to tracking_type;
