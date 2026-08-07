-- Split the 'arms' region into separate 'biceps' and 'triceps' regions.
--
-- Pull work and push work load the arms on different days, so folding biceps
-- and triceps into one 'arms' bucket hid the imbalance the split is meant to
-- surface. Elbow flexors (biceps, brachialis) and forearms roll up to 'biceps';
-- the triceps stand alone.
--
-- Postgres can't drop an enum value, and altering an enum used by a column is
-- awkward, so this adds the two new values, remaps every referencing row, and
-- leaves the now-unused 'arms' value in place (harmless — nothing references it).

-- 1. Add the new enum values. ADD VALUE can't run inside a txn block with other
--    statements that use it, so these come first and commit before the updates.
alter type region add value if not exists 'biceps';
alter type region add value if not exists 'triceps';

commit;

-- 2. Remap the seeded muscle rows. Triceps → 'triceps'; the rest of the old
--    'arms' muscles → 'biceps'.
update muscles set region = 'triceps' where id = 'triceps';
update muscles set region = 'biceps'  where region = 'arms';
