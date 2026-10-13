create or replace function keep_newer_revision()
returns trigger language plpgsql as $$
begin
  if new.client_rev < old.client_rev then
    old.updated_at := now();
    return old;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'log_entries', 'body_weights', 'recipes', 'meal_templates',
                           'programs', 'check_ins', 'custom_foods', 'water_logs']
  loop
    execute format(
      'create or replace trigger %I_guard before update on %I
         for each row execute function keep_newer_revision()', t, t);
  end loop;

  foreach t in array array['custom_foods', 'water_logs']
  loop
    execute format(
      'create or replace trigger %I_timestamps before insert or update on %I
         for each row execute function set_row_timestamps()', t, t);
  end loop;
end $$;
