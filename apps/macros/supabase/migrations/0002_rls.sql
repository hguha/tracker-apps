-- Row-Level Security. On every table; failures are silent and total.
--
-- Two shapes, the same pair COINcidence uses:
--   1. Client-authored — full access to your own rows (user_id = auth.uid()).
--   2. Server-authored reference data — everyone may SELECT, nobody may write. With no
--      insert/update/delete policy those statements are denied for any normal user, so a
--      client can never forge a food row and corrupt another user's history. The `foods`
--      edge function writes under the service role, which bypasses RLS.

alter table foods          enable row level security;
alter table log_entries    enable row level security;
alter table body_weights   enable row level security;
alter table recipes        enable row level security;
alter table meal_templates enable row level security;
alter table programs       enable row level security;
alter table check_ins      enable row level security;

create policy "own log_entries" on log_entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own body_weights" on body_weights for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own recipes" on recipes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own meal_templates" on meal_templates for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own programs" on programs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own check_ins" on check_ins for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read foods" on foods for select using (true);
