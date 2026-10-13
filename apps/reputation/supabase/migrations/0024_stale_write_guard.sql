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
  foreach t in array array['profiles', 'exercises', 'workouts', 'workout_exercises', 'sets',
                           'templates', 'template_exercises', 'metric_definitions', 'metric_entries']
  loop
    execute format(
      'create or replace trigger %I_guard before update on %I
         for each row execute function keep_newer_revision()', t, t);
    execute format(
      'create or replace trigger %I_touch before insert or update on %I
         for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;
