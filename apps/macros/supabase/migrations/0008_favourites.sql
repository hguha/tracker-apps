-- Foods the user pinned.
--
-- "Frequent" is derived from the log and can't be curated: it takes a fortnight to admit a new
-- staple and never forgets an old one. This is the answer to "where do I save just this food".
--
-- On the profile rather than in its own table because it is a short list of ids with no attributes
-- of its own, and it has to follow the account onto a second device the same way appearance does.
-- Defaulted to an empty array so an older client's row reads as "none" rather than as null.

alter table profiles add column if not exists favourite_food_ids jsonb not null default '[]';
