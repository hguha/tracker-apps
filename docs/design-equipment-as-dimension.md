# Design: exercise = movement + equipment

**Status:** built · **Migration:** 0014 (applied) · **Decisions locked:** records per (movement+equipment); equipment drives tracking type; build directly.

## Superseded — see "Full normalization (as built)" below

The "group, don't re-key" model above was built first, then replaced: the desired
UX is equipment-free **base exercises** with equipment chosen at add time and
stored on the workout, plus existing history backfilled with the equipment each
set used. That's the fuller model this section originally set aside.

## Final model: equipment fully decoupled (0016)

Simplified again: an exercise stores **no equipment at all**. Any movement can be
loaded with any equipment, so:

- `Exercise` drops `equipmentOptions`/`unilateralEquipment` (and the old scalar
  `equipment`/`isUnilateral`). It's just a movement + muscle + tracking type.
- Adding to a workout is movement → **mandatory equipment step** (all 9 types) →
  logged with that equipment on the `WorkoutExercise`. The library/picker equipment
  *filter* is gone — you pick equipment when adding, you don't filter by it.
- **No dumbbell doubling.** `loadUnitsMoved` and all equipment-specific volume math
  are deleted; entered weight is taken as-is. The log hint tells you to add both
  dumbbells (so two-implement lifts and unilateral cables aren't half-counted).
- **"One side at a time" removed** entirely (unilateral was never wired into the set
  UI).
- **Editing (new):** the exercise detail has an edit button. Editing your own
  exercise updates in place (syncs). Editing a built-in (system, RLS-read-only)
  forks it to a user-owned copy, repoints your history/templates to the fork, and
  archives the original locally — so the edit sticks and syncs.
- Server migration 0016 drops the equipment columns from `exercises`;
  `workout_exercises.equipment`, `template_exercises.equipment`, and
  `personal_records.equipment` remain (equipment lives on the workout; records stay
  per exercise+equipment).

The sections below describe the intermediate "base + equipment-on-exercise" model
that this replaced; kept for history.

## Full normalization (as built, then simplified by 0016)

- **Model.** `Exercise` is a base movement ("Bench Press") with `equipmentOptions: Equipment[]` and `unilateralEquipment: Equipment[]` — no scalar equipment/isUnilateral. `WorkoutExercise` and `TemplateExercise` carry the chosen `equipment`. `PersonalRecord` gains `equipment` (id `` `${exerciseId}:${equipment}:${recordType}` ``); `LastPerformance` is keyed `` `${exerciseId}:${equipment}` ``. Records, last-time, and volume are all per (base + equipment).
- **Derivation.** `deriveBases()` in `src/db/seed/bases.ts` folds the per-variant seed into base rows using `movementFor()` (+ the two seed `movement` overrides), and emits the old→(base, equipment) mapping. Tracking type, primary muscle, and bodyweight factor are constant within a base (asserted by `bases.test.ts`); equipment and one-sidedness are the only per-variant facts, and both become base metadata.
- **Volume math.** `volumeLoadKg`/`effectiveWeightKg` take `equipment` + `isUnilateral` explicitly (resolved via `isUnilateralWith(exercise, equipment)`); every call site sources them from the WorkoutExercise.
- **Client migration.** `migrateToBaseExercises()` (repository, run at boot after seeding, idempotent) repoints each workout/template exercise to (base, equipment), reshapes custom rows, archives the old system variants, and rebuilds the per-(exercise+equipment) records + last-time caches. Synced tables are enqueued; the derived caches are rebuilt locally (they don't sync).
- **Server migration 0015.** Adds `equipment_options`/`unilateral_equipment` to exercises, inserts base rows, converts custom rows, adds `equipment` to workout/template exercises and backfills+repoints from the same mapping, archives old system variants (kept, not dropped → reversible), and adds `equipment` to personal_records.
- **UI.** `<MovementList>` lists base exercises; a multi-equipment base expands to equipment chips, a single-equipment base picks straight through. `composeExerciseName(base, equipment)` renders "Barbell Bench Press" across the card, history, and preview. `NewExerciseForm` takes multi-select equipment. The exercise detail shows all equipment options + which are per-side.
- **Reverted from the grouping model:** `groupByMovement`, the `Exercise.movement` field, and the insights By-exercise/By-movement toggle (each exercise is already a movement now).

## Goal

In the library you pick a *movement* — "Bench Press", "Back Squat", "Dip" — then choose the equipment (barbell, dumbbell, cable, machine, smith, kettlebell, assisted, bodyweight). Insights can then answer both "how strong is my squat?" (all equipment) and "how strong is my barbell squat?" (one). Records and last-time stay scoped to the exact (movement, equipment) pair, and the log UI matches the equipment (a bodyweight dip logs reps, an assisted dip logs assisted, a machine dip logs weight×reps).

## Model decision: group, don't re-key

The library **already** is one row per (movement, equipment) — 210 rows, each with its own `tracking_type` and `bodyweight_factor`; PRs are keyed `exerciseId:recordType`; `workout_exercises.exercise_id` and `last_performance`/placeholders all key on the exercise id.

So we keep the exercise row as the (movement, equipment) identity and add a **`movement` grouping slug**. This delivers both locked decisions for free:

- **Records per (movement+equipment)** — already true, since each combo is its own exercise id. No `personal_records` re-key, no history rewrite.
- **Equipment drives tracking** — each combo row carries its own `tracking_type`, so choosing equipment in the picker resolves to the row with the right log UI. No dynamic per-set tracking resolution.

The user sees one "Dip" with an equipment selector; underneath it resolves to the existing distinct rows. *Alternative considered — full normalization (a `movements` table + `equipment` column on `workout_exercises`) — is rejected: identical UX and record scope, but forces re-keying every logged `workout_exercise` and every PR on live data. Not worth the blast radius.*

## Schema — migration 0014 (additive, non-destructive)

```sql
alter table exercises add column movement text not null default '';
-- backfill by stripping the equipment word from the name (CASE mirrors
-- movementFor() in domain/movement.ts; irregulars handled by the override map)
update exercises set movement = ... ;
```

No changes to `workout_exercises`, `sets`, `personal_records`, or `last_performance`. The seed is re-emitted to a **new** migration (0004 is append-only), with `movement` set via the shared deriver so server and client can't disagree — same discipline used for `movement_pattern` in 0013.

## Movement derivation (one source of truth)

`movementFor(name)` in `domain/movement.ts`, used by the seed generator, the 0014 backfill (as a SQL CASE), and a launch-time repair for custom rows:

- Strip a leading equipment adjective — Barbell, Dumbbell, Cable, Machine, Smith, Kettlebell, Band, EZ-Bar, Trap Bar. `"Incline Barbell Bench Press"` → **movement** `"Incline Bench Press"`, **equipment** `barbell`.
- **Grip/angle stays in the movement** (Incline, Decline, Close-Grip, Wide-Grip, Sumo, Romanian): an incline press is a different lift, not a barbell "variant". So `"Incline Bench Press"` and `"Bench Press"` are distinct movements, each with its own equipment set.
- Names with no equipment word (Push-up, Pull-up, Dip, Plank) → movement = whole name; equipment already set on the row.
- ~30 irregulars (Goblet Squat, Zercher Squat, Pendlay Row, Landmine Press, Hack Squat…) via a curated override map. Unit-tested: every seed row maps to a sensible movement, and known families (all bench variants, all squat variants) group as expected.

## UI

- **Library** (`ExerciseLibraryScreen`): list grouped by `movement` — one row per movement with region dot, movement label, and "N equipment". A–Z / recent sort preserved (by movement). Tap → movement detail with equipment options.
- **Picker** (`ExercisePicker` → `addExerciseToWorkout`): search by movement + alias → tap movement → equipment chips (only the equipment that exists for that movement; default = most-recently-used). One-equipment movements skip the chooser. Resolves to the concrete `exerciseId`; the rest of the log path is unchanged.
- **Create/edit** (`NewExerciseForm`): fields become **movement** (autocomplete existing or new) + **equipment** + tracking type + bodyweight factor. Display name auto-composed as `"{Equipment} {Movement}"` (Barbell + Back Squat → "Barbell Back Squat"), overridable.

## Insights

`useInsightsData` already builds `seriesByExercise`; add `seriesByMovement` keyed on `movement`, and a per-chart **By exercise / By movement** toggle on the strength/volume charts:

- top-set & e1RM "by movement" = max across the movement's equipment per session; volume "by movement" = sum.
- PR-estimator quick-lift chips group by movement.

Records stay per-exercise (= per combo). A "best across equipment" movement PR, if wanted, is a derived read over the group — not stored.

## What does **not** change

Last-time header, placeholders, PR detection/glow, deferred-sync, and the outbox all key on `exerciseId` and are untouched — a barbell-bench "last time" never shows dumbbell numbers.

## Risks

1. **Bad movement grouping** on irregular names → noisy library. *Mitigation:* override map + a test asserting family groupings.
2. **Angle/grip vs equipment ambiguity** — resolved by the rule above (grip/angle → movement, only the equipment word is stripped).
3. **Custom rows written pre-0014** → backfilled by the launch repair, same as the `movement_pattern` repair.
4. **Live DB migration** — apply and validate via the `supabase/migrations/README.md` loop (before/after counts; invariant `count(*) where movement=''` is 0 after backfill).

## Build order & test plan

1. `movementFor` + override map + tests. 2. `movement` on `Exercise` type + seed. 3. Migration 0014 + regenerated seed migration; apply & verify on the linked project. 4. Picker/library/editor. 5. Insights by-movement toggle. 6. Tests: deriver & family grouping, picker resolves equipment→exercise, by-movement aggregation, seed cardio/push-pull still derive correctly.

Scope: **medium, mostly additive** — no destructive migration, no history or PR re-keying.
