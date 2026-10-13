alter table profiles add column if not exists celebrated jsonb;
alter table profiles add column if not exists xp_high_water integer not null default 0 check (xp_high_water >= 0);
