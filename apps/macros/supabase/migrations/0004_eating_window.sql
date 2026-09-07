-- An eating window (minutes from local midnight), for anyone who keeps one. Nullable because
-- "I eat whenever" is the common case and must not be stored as a window of the whole day.
alter table profiles add column if not exists eating_window jsonb;
