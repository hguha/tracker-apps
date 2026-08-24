-- Fully decouple equipment from exercises. A movement can be loaded with any
-- equipment, so the choice lives on workout_exercises (0015); the exercise stores
-- nothing about equipment. This drops the columns 0015 added to exercises plus the
-- long-retired scalar equipment/is_unilateral, and the equipment enum's
-- companion "one side at a time" concept, which the app no longer models.
--
-- workout_exercises.equipment and template_exercises.equipment stay — that's where
-- equipment now lives. personal_records.equipment stays (records are per
-- exercise+equipment). Nothing here touches history or records.

alter table exercises drop column if exists equipment_options;
alter table exercises drop column if exists unilateral_equipment;
alter table exercises drop column if exists equipment;
alter table exercises drop column if exists is_unilateral;
