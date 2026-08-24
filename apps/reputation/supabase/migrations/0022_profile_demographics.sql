-- Profile demographics the conversational coach tailors against.
--
-- The AI coach now factors sex, age, lifting experience, and weekly training
-- availability into its advice (strength standards, volume, progression pacing).
-- All four are optional and default to "unset" (null), so existing rows need no
-- backfill and the client tolerates their absence.
--
-- Kept as nullable text with CHECK constraints rather than new enum types: the set
-- is tiny and unlikely to grow, and a CHECK avoids the add/drop/rename dance an
-- enum change would later require (see 0013 / 0021 / README).

alter table profiles
  add column if not exists sex text
    check (sex is null or sex in ('male', 'female'));

alter table profiles
  add column if not exists birth_year int
    check (birth_year is null or (birth_year > 1900 and birth_year < 2200));

alter table profiles
  add column if not exists experience_level text
    check (
      experience_level is null
      or experience_level in ('beginner', 'intermediate', 'advanced')
    );

alter table profiles
  add column if not exists training_days_per_week int
    check (
      training_days_per_week is null
      or (training_days_per_week >= 0 and training_days_per_week <= 7)
    );
