# Migrations — applying and verifying against the live database

These are the exact steps I (Claude Code) can run in this environment to apply a
migration to the linked Supabase project and prove it worked. Written down
because the interesting part isn't the push — it's the before/after checks that
turn "it ran without error" into "it did what it was supposed to."

The project is already linked (`supabase link` was done once). CLI is v2.86.0,
pinned deliberately — a newer version had a `SchemaError` on `link` (see the
project history). Every command below works headless.

## The tools available here

- **`supabase migration list`** — shows Local vs Remote columns. A version with
  a blank Remote is unapplied. This is the first and last thing to check.
- **`supabase db push`** — applies unapplied migrations. It prompts; pipe `echo
  "Y"` to it in a non-interactive shell. Each migration runs in a transaction,
  so a failure rolls the whole file back — a failed push leaves the DB untouched,
  not half-migrated.
- **`supabase db query --linked "<sql>"`** — runs read **or** write SQL against
  the *remote* database via the Management API. **`--linked` is required**;
  without it the CLI tries `127.0.0.1:54322` (a local Postgres that isn't
  running here) and fails with a connection-refused error. Use this for all the
  before/after verification.
- **`supabase db lint --linked`** — static schema check; should say "No schema
  errors found."

Not available here: Docker, a local Postgres, and `psql`. So everything is
against the linked project directly — there is no local db to `db reset` against.
That makes the before/after discipline below the only safety net, so don't skip
it.

## The loop

1. **Read the migration** and write down, in plain terms, every change it makes
   and what each should produce.

2. **Capture the before-state** with `db query --linked`. Query the specific
   things the migration touches: does a table exist, how many rows, what are an
   enum's values, what's a column's distribution. Save the numbers.

3. **Compute the expected after-state independently.** If a migration remaps a
   column by some rule, run that rule as a read-only query *before* pushing and
   record what it predicts. This is what lets step 5 be "matches the number I
   predicted" rather than "looks plausible."

4. **Push** with `supabase db push`. If it errors, first confirm the rollback
   was clean (re-run the before-state queries — they should be unchanged and the
   migration should not appear in `supabase_migrations.schema_migrations`), then
   fix the SQL and push again.

5. **Verify the after-state** against both the before numbers and the
   independent prediction from step 3. Prefer an *invariant* query — one that
   returns 0 when correct — over eyeballing counts. Example: after deriving a
   column from another table, `count(*) where derived <> expected_rule` must be
   0, which is far stronger than checking totals add up.

6. **Confirm sync + lint.** `supabase migration list` should show the version in
   both columns; `db lint --linked` should be clean.

## Gotchas learned the hard way

- **`ALTER COLUMN ... TYPE ... USING (<subquery>)` is rejected** by Postgres
  ("cannot use subquery in transform expression"). If a type change needs data
  from another table, do add-column → `UPDATE ... FROM` → drop → rename instead
  (a plain UPDATE allows joins). This is exactly how 0013 collapses the
  `movement_pattern` enum. The first version used a USING subquery, the push
  failed, the transaction rolled back, and the before-state queries confirmed
  nothing had changed before I rewrote it.
- **`check` and other reserved words** can't be a bare column alias — quote them
  or pick another name.
- **Migration history is append-only.** Never regenerate an already-applied
  migration in place (notably `0004_seed_library.sql`): it runs before later
  migrations and replaying it against a changed schema fails. New library rows go
  in a *new* migration, and the seed generator is idempotent
  (`on conflict do nothing`) so re-seeding only inserts what's missing.

## Worked example: 0013 (drop secondary muscles, collapse movement_pattern)

```bash
# 1–2. before-state (remote)
supabase db query --linked "
  select 'join_table', count(*)::text from information_schema.tables
    where table_schema='public' and table_name='exercise_secondary_muscles'
  union all select 'total_exercises', count(*)::text from exercises
  union all select 'pattern_'||movement_pattern::text, count(*)::text
    from exercises group by movement_pattern;"
# → join table present (226 secondary rows), 159 exercises, 11-value enum

# 3. independent prediction of the new distribution, by region
supabase db query --linked "
  select case m.region
           when 'cardio' then 'cardio'
           when 'chest' then 'push' when 'shoulders' then 'push' when 'triceps' then 'push'
           when 'back' then 'pull' when 'biceps' then 'pull' else 'other' end,
         count(*) from exercises e join muscles m on m.id=e.primary_muscle_id group by 1;"
# → push 45, pull 41, other 57, cardio 16

# 4. push
echo "Y" | supabase db push

# 5. verify — the invariant version: this must return 0
supabase db query --linked "
  select count(*) from exercises e join muscles m on m.id=e.primary_muscle_id
  where e.movement_pattern::text <> (case m.region
    when 'cardio' then 'cardio' when 'chest' then 'push' when 'shoulders' then 'push'
    when 'triceps' then 'push' when 'back' then 'pull' when 'biceps' then 'pull'
    else 'other' end);"
# → 0, and the distribution matched the step-3 prediction exactly

# 6.
supabase migration list      # 0013 in both Local and Remote
supabase db lint --linked    # No schema errors found
```
