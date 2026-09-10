-- Water, one row per day.
--
-- Not a `log_entries` row. Water has no food behind it, no macros, and no portion, so every
-- aggregate the app runs over the diary — `dayTotals`, occasion grouping, the venue split, the
-- micronutrient average — would have to learn to skip it, and any one of them forgetting would
-- report a glass of water as a meal. A day's intake is also a single running number the user adds
-- to, not a list of events worth keeping, which is why the id is deterministic per day: tapping
-- "+ a glass" twelve times leaves twelve outbox writes to one row rather than twelve rows.
--
-- Millilitres on the wire regardless of what the user is shown, exactly like `body_weights` storing
-- kilograms: the display unit is a preference, and storing the preference in the data is how two
-- devices come to disagree about how much someone drank.

create table if not exists water_logs (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day        text not null,
  ml         integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev integer not null default 1,

  constraint water_ml_nonnegative check (ml >= 0)
);

create unique index if not exists water_logs_user_day on water_logs (user_id, day);
create index if not exists water_logs_user_updated on water_logs (user_id, updated_at);

alter table water_logs enable row level security;

create policy "own water_logs" on water_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
