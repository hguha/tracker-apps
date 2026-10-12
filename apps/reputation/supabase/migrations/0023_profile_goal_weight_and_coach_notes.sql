alter table profiles
  add column if not exists goal_weight_kg numeric
    check (goal_weight_kg is null or (goal_weight_kg > 0 and goal_weight_kg < 1000));

alter table profiles
  add column if not exists goal_start_kg numeric
    check (goal_start_kg is null or (goal_start_kg > 0 and goal_start_kg < 1000));

alter table profiles
  add column if not exists coach_notes text not null default ''
    check (char_length(coach_notes) <= 500);
