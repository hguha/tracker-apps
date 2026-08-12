-- Drop secondary muscles; collapse movement_pattern to four values.
--
-- Both were taxonomy the app asked for and never used well:
--
--   exercise_secondary_muscles  Weighted partial volume credit (bench → front
--                               delt at 0.50). Precise-looking but guesswork per
--                               exercise, it never surfaced a number anyone acted
--                               on, and it made adding an exercise a research
--                               task. The client stopped reading it entirely.
--
--   movement_pattern            Eleven hand-tagged values (squat vs hinge,
--                               horizontal vs vertical push). Nothing answered a
--                               question with the distinction, and picking one
--                               turned the create-exercise form into a quiz.
--
-- The column survives with four values because two features need a coarse
-- version, and both are now DERIVED from the primary muscle's region rather than
-- asked for (see src/domain/movement.ts, which the SQL seed generator also uses
-- so server and client can never disagree):
--
--   cardio        switches the logging UI to time/distance. Every cardio exercise
--                 has a primary muscle in the 'cardio' region — verified 1:1
--                 against the live data before writing this (no cardio-tagged row
--                 sits in a non-cardio region), so region alone decides the map.
--   push / pull   lets a session title read "Push" rather than "Chest".
--   other         legs, core, everything else.
--
-- Keeping the column rather than dropping it means no change to the sync payload
-- shape and no client release ordering problem.

-- The join table is read by nothing. `cascade` takes its RLS policies with it.
drop table if exists public.exercise_secondary_muscles cascade;

-- Rebuild the enum with the four values, remapping every row by its primary
-- muscle's region — exactly what patternForRegion() does on the client.
--
-- Done as add-column / UPDATE / swap rather than `alter column ... type ... using
-- (<subquery>)`: Postgres rejects a subquery inside a USING transform
-- ("cannot use subquery in transform expression"), and the mapping needs a join
-- to muscles. A plain UPDATE ... FROM has no such restriction.
create type movement_pattern_v2 as enum ('push', 'pull', 'other', 'cardio');

alter table exercises add column movement_pattern_new movement_pattern_v2;

update exercises e
set movement_pattern_new = (
  case m.region
    when 'cardio' then 'cardio'
    when 'chest' then 'push'
    when 'shoulders' then 'push'
    when 'triceps' then 'push'
    when 'back' then 'pull'
    when 'biceps' then 'pull'
    else 'other'
  end
)::movement_pattern_v2
from muscles m
where m.id = e.primary_muscle_id;

-- Every exercise has a primary muscle (FK), so the join covers all rows; assert
-- it before dropping the old column, so a surprise NULL fails the migration
-- rather than silently producing a NOT NULL violation with no context.
do $$
begin
  if exists (select 1 from exercises where movement_pattern_new is null) then
    raise exception 'movement_pattern_new is null for % row(s); aborting',
      (select count(*) from exercises where movement_pattern_new is null);
  end if;
end $$;

alter table exercises drop column movement_pattern;
alter table exercises rename column movement_pattern_new to movement_pattern;
alter table exercises alter column movement_pattern set not null;

drop type movement_pattern;
alter type movement_pattern_v2 rename to movement_pattern;
