-- Targets the user typed in, with the day they start applying from.
--
-- The app's premise is that a calorie target is measured rather than chosen — computed from intake
-- against weight trend at each check-in — and that premise is right. But it left no way to say "I want
-- 2,400 and 180 g of protein", which people have good reasons for: a coach's plan, a training block,
-- a number that has worked before. Refusing the question doesn't make the answer come from the weight
-- trend; it makes the app the wrong tool for anyone who already has one.
--
-- Carries `fromDay` for the same reason a check-in carries `week_start`: yesterday's 2,300 kcal was
-- not over a target that only exists now, so a manual number applies forward and the past keeps
-- whatever it was scored against. Clearing the column returns to the measured target, which has been
-- computed underneath all along.

alter table profiles add column if not exists manual_targets jsonb;
