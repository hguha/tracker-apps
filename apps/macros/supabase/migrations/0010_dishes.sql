-- The thing the user thinks they ate.
--
-- "3 steak tacos" resolves to six USDA rows — tortilla, top round, cheddar, onion, coriander,
-- sour cream — and every one of them is needed for the macros and the micronutrients to be right.
-- But the diary then contains no line the person recognises, and nothing to tap to say "I had
-- another one". These two columns tie a set of rows written together back to the dish they came
-- from, so the day can show one line and still hold every ingredient underneath it.
--
-- Deliberately not a table. A dish is not an entity with a lifecycle — it is a fact about how some
-- rows were entered, and it must survive a food being corrected, an ingredient being deleted, and a
-- row being moved to another meal. A foreign key to a `dishes` table would make all four of those
-- either impossible or a cascade, for no gain: nothing needs to be looked up *by* dish except the
-- rows themselves.
--
-- `dish_name` is stored per row rather than once, for the same reason `nutrients` is: it is what the
-- user typed at the time, and re-deriving it later would let a rename rewrite history.

alter table log_entries add column if not exists dish_id text;
alter table log_entries add column if not exists dish_name text;

create index if not exists log_entries_dish_idx
  on log_entries (user_id, dish_id)
  where deleted_at is null and dish_id is not null;
