-- Tracks which onboarding revision an account last completed, so a reworked
-- walkthrough can be re-shown to everyone by bumping ONBOARDING_VERSION in the
-- client. 0 = hasn't done the current flow. Existing rows default to 0 so they
-- replay the new onboarding once.
alter table profiles add column onboarding_version int not null default 0;
