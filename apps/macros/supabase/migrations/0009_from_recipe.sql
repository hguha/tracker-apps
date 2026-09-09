-- Where a logged food came from, when a recipe was logged as its ingredients.
--
-- Provenance, not subject: the row's subject is a food, and `one_subject` constrains exactly one of
-- food_id / recipe_id / quick_add. Reusing recipe_id would violate it. Without this column, logging
-- a recipe the better way — one row per ingredient, so the micronutrients count — silently detached
-- those rows from the recipe, and "what you cook" stopped counting them.

alter table log_entries add column if not exists from_recipe_id text;

create index if not exists log_entries_from_recipe_idx
  on log_entries (user_id, from_recipe_id)
  where deleted_at is null and from_recipe_id is not null;
