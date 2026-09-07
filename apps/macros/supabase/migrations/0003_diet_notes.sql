-- Free text the coach reads: allergies, "vegetarian", foods to avoid. On the profile rather
-- than device-local because a preference that doesn't follow the account is worthless.
alter table profiles add column if not exists diet_notes text not null default '';
