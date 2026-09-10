-- How active the user is, for the cold-start expenditure estimate.
--
-- Only the first fortnight uses it: from the first real check-in, expenditure is measured from
-- intake against weight trend and this field changes nothing. Before there was a question, the
-- formula assumed three training sessions a week for everybody — so a desk job and manual labour
-- got the same week-one target, wrong in opposite directions by roughly 500 kcal a day.
--
-- Nullable rather than defaulted, because "nobody has said" and "moderately active" are different
-- facts: the estimator reads the first as moderate *with a wider error bar*, which is the honest
-- treatment of a guess it made itself.

alter table profiles add column if not exists activity text;
