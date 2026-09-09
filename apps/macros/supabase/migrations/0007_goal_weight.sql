-- A weight the program is aiming at.
--
-- The rate alone was the right input for a calorie target and a useless thing to aim at: nothing
-- ever satisfies "lose 0.5% a week", so reaching a weight you cared about did nothing. These three
-- give the goal an end, a denominator for progress, and a record of having arrived.
--
-- All nullable: a maintain program has no target, and every program that existed before this
-- migration has none either. `start_kg` is captured when the target is set, not derived later —
-- re-deriving it would move the goalposts every time the trend moved.

alter table programs add column if not exists target_kg numeric;
alter table programs add column if not exists start_kg  numeric;
alter table programs add column if not exists reached_at timestamptz;
