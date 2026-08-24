-- Workout Tracker — schema (spec §4)
--
-- Storage is always metric (§4.12): weight_kg, distance_m, lengths in cm.
-- Every user-owned table carries the sync columns (§4.11) and has its id
-- generated client-side so an offline insert replays as an idempotent upsert.
--
-- This mirrors the TypeScript domain in src/domain/types.ts one-to-one, so the
-- same row shapes move between IndexedDB and Postgres without translation.

-- Enums -----------------------------------------------------------------------

create type region as enum
  ('chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio');

create type equipment as enum
  ('barbell', 'dumbbell', 'machine', 'cable', 'smith',
   'bodyweight', 'kettlebell', 'band', 'other');

create type movement_pattern as enum
  ('squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push',
   'horizontal_pull', 'vertical_pull', 'carry', 'rotation', 'isolation', 'cardio');

create type tracking_type as enum
  ('weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'assisted_bodyweight',
   'reps_only', 'time', 'distance_time', 'weight_time');

create type set_type as enum
  ('normal', 'warmup', 'dropset', 'failure', 'amrap', 'backoff');

create type record_type as enum
  ('max_weight', 'max_reps_any_weight', 'max_est_1rm', 'max_volume_session',
   'max_reps_at_weight', 'max_duration', 'max_distance');

create type metric_unit_type as enum
  ('mass', 'length', 'percent', 'count', 'duration', 'ratio', 'arbitrary');

create type metric_category as enum
  ('body_composition', 'circumference', 'vitals', 'performance', 'subjective', 'custom');

-- Sync columns, applied to every user-owned table (§4.11) --------------------
-- Declared as a macro-by-convention: each table repeats these four columns.
-- created_at / updated_at are set from the server clock by trigger, so a phone
-- with a wrong clock cannot poison ordering. deleted_at is a tombstone.

-- profiles (§4.1) -------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  unit_weight text not null default 'lb' check (unit_weight in ('lb', 'kg')),
  unit_distance text not null default 'mi' check (unit_distance in ('mi', 'km')),
  unit_length text not null default 'in' check (unit_length in ('in', 'cm')),
  timezone text not null default 'UTC',
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1)),
  default_rest_seconds int not null default 60,
  show_rpe boolean not null default false,
  chart_prefs jsonb not null default '{}'::jsonb,
  ai_opt_in boolean not null default false,
  bodyweight_cache_kg numeric,
  theme text not null default 'default',
  color_scheme text not null default 'system' check (color_scheme in ('system', 'light', 'dark')),
  accent_override text,
  sound_enabled boolean not null default true,
  auto_start_rest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

-- muscles (§4.2) — seeded and user-extensible. null user_id = system row.
--
-- Library ids (muscles, exercises, metric_definitions) are `text`, not `uuid`:
-- system rows carry stable readable slugs ('mid_chest', 'barbell_bench_press')
-- seeded identically on the server and in every device's IndexedDB, so the two
-- sides upsert to the same key. A user-created row still gets a uuid string,
-- which `text` holds fine. Everything user-owned (workouts, sets, …) stays uuid.

create table muscles (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  region region not null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

-- exercises (§4.3) — null user_id = system library row.

create table exercises (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  primary_muscle_id text not null references muscles(id),
  aliases text[] not null default '{}',
  equipment equipment not null,
  movement_pattern movement_pattern not null,
  tracking_type tracking_type not null default 'weight_reps',
  is_unilateral boolean not null default false,
  bodyweight_factor numeric(3, 2),
  is_key_lift boolean not null default false,
  notes text not null default '',
  default_rest_seconds int,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

create table exercise_secondary_muscles (
  exercise_id text not null references exercises(id) on delete cascade,
  muscle_id text not null references muscles(id),
  contribution numeric(3, 2) not null default 0.50,
  primary key (exercise_id, muscle_id)
);

-- workouts (§4.4) -------------------------------------------------------------

create table workouts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  title text not null default '',
  notes text not null default '',
  perceived_exertion int check (perceived_exertion between 1 and 10),
  template_id uuid,
  bodyweight_kg numeric,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

-- At most one in-progress workout per user — the resume mechanism (§4.4, §4.14).
create unique index one_active_workout on workouts (user_id)
  where ended_at is null and deleted_at is null;

create table workout_exercises (
  id uuid primary key,
  workout_id uuid not null references workouts(id) on delete cascade,
  exercise_id text not null references exercises(id),
  position int not null,
  superset_group int,
  rest_seconds int,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

create table sets (
  id uuid primary key,
  workout_exercise_id uuid not null references workout_exercises(id) on delete cascade,
  position int not null,
  set_type set_type not null default 'normal',
  weight_kg numeric(7, 2),
  reps int,
  reps_left int,
  reps_right int,
  duration_seconds int,
  distance_m numeric(9, 2),
  rpe numeric(3, 1),
  rir int,
  rest_taken_seconds int,
  is_completed boolean not null default false,
  completed_at timestamptz,
  notes text not null default '',
  entered_unit text check (entered_unit in ('lb', 'kg')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

-- templates (§4.7) ------------------------------------------------------------

create table templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  folder text,
  last_used_at timestamptz,
  times_used int not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

create table template_exercises (
  id uuid primary key,
  template_id uuid not null references templates(id) on delete cascade,
  exercise_id text not null references exercises(id),
  position int not null,
  superset_group int,
  target_sets int,
  target_reps_low int,
  target_reps_high int,
  target_weight_kg numeric(7, 2),
  target_rpe numeric(3, 1),
  rest_seconds int,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

-- personal_records (§4.8) — materialized, rebuildable via rebuild_prs().

create table personal_records (
  id text primary key, -- `${exercise_id}:${record_type}`, client-generated
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null references exercises(id),
  record_type record_type not null,
  value numeric not null,
  achieved_at timestamptz not null,
  set_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

-- Body metrics (§4.9) ---------------------------------------------------------

create table metric_definitions (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  key text not null,
  label text not null,
  unit_type metric_unit_type not null,
  category metric_category not null,
  higher_is_better boolean,
  aggregation text not null default 'last' check (aggregation in ('last', 'mean', 'min', 'max')),
  precision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

create table metric_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  definition_id text not null references metric_definitions(id),
  measured_at timestamptz not null,
  value numeric not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  client_rev int not null default 1
);

-- Push and scheduling (§4.10) ------------------------------------------------

create table push_subscriptions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  consecutive_failures int not null default 0
);

create table scheduled_notifications (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fire_at timestamptz not null,
  kind text not null check (kind in ('rest_timer', 'reminder')),
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  cancelled_at timestamptz
);

-- Invite-only signup (§4.13) --------------------------------------------------

create table allowed_emails (
  email text primary key
);

-- Indexes (§4.14) -------------------------------------------------------------

create index workouts_user_started on workouts (user_id, started_at desc)
  where deleted_at is null;
create index workout_exercises_workout_pos on workout_exercises (workout_id, position);
create index workout_exercises_exercise on workout_exercises (exercise_id);
create index sets_we_pos on sets (workout_exercise_id, position);
create index metric_entries_lookup on metric_entries (user_id, definition_id, measured_at desc);
create index scheduled_pending on scheduled_notifications (fire_at) where sent_at is null;

-- Delta-pull support: every synced table is queried by updated_at, so index it.
create index workouts_updated on workouts (user_id, updated_at);
create index workout_exercises_updated on workout_exercises (updated_at);
create index sets_updated on sets (updated_at);
create index templates_updated on templates (user_id, updated_at);
create index template_exercises_updated on template_exercises (updated_at);
create index personal_records_updated on personal_records (user_id, updated_at);
create index metric_entries_updated on metric_entries (user_id, updated_at);
create index exercises_updated on exercises (updated_at);
create index muscles_updated on muscles (updated_at);
