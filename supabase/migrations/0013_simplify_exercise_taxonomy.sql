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
--                 has a primary muscle in the 'cardio' region — a 1:1 match
--                 across all 21 seeded cardio rows.
--   push / pull   lets a session title read "Push" rather than "Chest".
--   other         legs, core, everything else.
--
-- Keeping the column rather than dropping it means no change to the sync payload
-- shape and no client release ordering problem.

-- The join table is read by nothing. `cascade` takes its RLS policies with it.
drop table if exists public.exercise_secondary_muscles cascade;

-- Postgres won't remove enum values, so build the new type and swap onto it.
-- Existing rows are remapped by region, matching patternForRegion() exactly.
create type movement_pattern_v2 as enum ('push', 'pull', 'other', 'cardio');

alter table exercises
  alter column movement_pattern type movement_pattern_v2
  using (
    case
      when movement_pattern = 'cardio' then 'cardio'
      else (
        -- Derive from the primary muscle's region rather than trusting the old
        -- tag: the tags were inconsistent, and the region is what the client
        -- now uses. A missing muscle can't happen (FK), but coalesce keeps the
        -- cast total.
        select coalesce(
          case m.region
            when 'cardio' then 'cardio'
            when 'chest' then 'push'
            when 'shoulders' then 'push'
            when 'triceps' then 'push'
            when 'back' then 'pull'
            when 'biceps' then 'pull'
            else 'other'
          end,
          'other'
        )
        from muscles m
        where m.id = exercises.primary_muscle_id
      )
    end
  )::movement_pattern_v2;

drop type movement_pattern;
alter type movement_pattern_v2 rename to movement_pattern;
