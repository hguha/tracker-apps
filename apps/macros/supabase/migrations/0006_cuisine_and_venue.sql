-- Cuisine on recipes, venue on log entries.
--
-- Both nullable with no default, deliberately. A default of 'home' would manufacture five weeks of
-- "cooked at home" for rows nobody ever answered the question about, and the charts built on this
-- would then be reporting a default as a habit.
--
-- Stored as text rather than an enum: the app owns the closed list (domain/types.ts CUISINES), and
-- an enum here would mean a migration every time that list grows, for a constraint the client
-- already enforces on the only write path.

alter table recipes add column if not exists cuisine text;
alter table recipes add column if not exists total_minutes integer;

alter table log_entries add column if not exists venue text;

-- Only the recipe filter needs an index. Venue is always read inside a date range the day index
-- has already narrowed, so an index on it would be carried on every write and used by nothing.
create index if not exists recipes_cuisine_idx
  on recipes (user_id, cuisine)
  where deleted_at is null and cuisine is not null;
