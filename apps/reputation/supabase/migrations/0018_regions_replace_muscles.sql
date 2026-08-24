-- The muscle taxonomy collapses to one level: an exercise stores the body region
-- it trains, instead of pointing at a row in a separate `muscles` table.
--
-- The two-level model existed so a reverse fly could tag "Rear Delt" under
-- shoulders. Nothing ever read the finer level — every chart, the coach summary,
-- the avatar, and session titles aggregate by region — so it was a second
-- taxonomy to maintain, and a second thing to pick when adding an exercise, with
-- no reader. `region` is denormalized onto exercises and `muscles` is dropped.
--
-- Ships WITH the client release that stops sending `primary_muscle_id`: an older
-- client's push would fail on the NOT NULL column that no longer exists.

-- 1. Denormalize region. The join through muscles was its only purpose.
alter table exercises add column region region;

update exercises e set region = m.region from muscles m where m.id = e.primary_muscle_id;

-- Prove the backfill was total before destroying the source it came from.
do $$
begin
  if exists (select 1 from exercises where region is null) then
    raise exception 'region is null for % exercise row(s); aborting',
      (select count(*) from exercises where region is null);
  end if;
end
$$;

alter table exercises alter column region set not null;
create index exercises_region on exercises (region);

-- 2. Drop the pointer, then the table. `cascade` takes the RLS policies, the
--    client_rev trigger, and the muscles_updated index with it. The `region` enum
--    type stays — it is now exercises.region's own type.
alter table exercises drop column primary_muscle_id;
drop table if exists public.muscles cascade;

-- 3. Two base ids changed with their labels: the stripped movement name "Curl"
--    reads as biceps or hamstring, and "Fly" as chest or rear delt, so the seed
--    now names them "Biceps Curl" and "Chest Fly". Insert the current library
--    (idempotent) so the new ids exist before history is repointed onto them.
insert into exercises (id, user_id, name, region, aliases, movement_pattern,
  tracking_type, bodyweight_factor) values
  ('bench_press', null, 'Bench Press', 'chest', array['bench', 'flat bench', 'bb bench', 'db bench', 'barbell bench press', 'dumbbell bench press', 'smith machine bench press']::text[], 'push', 'weight_reps', null),
  ('incline_bench_press', null, 'Incline Bench Press', 'chest', array['incline bench', 'incline db press', 'incline barbell bench press', 'incline dumbbell bench press']::text[], 'push', 'weight_reps', null),
  ('decline_bench_press', null, 'Decline Bench Press', 'chest', array['decline barbell bench press']::text[], 'push', 'weight_reps', null),
  ('chest_fly', null, 'Chest Fly', 'chest', array['cable crossover', 'dumbbell chest fly', 'cable chest fly', 'machine chest fly']::text[], 'push', 'weight_reps', null),
  ('low_to_high_fly', null, 'Low-to-High Fly', 'chest', array['low-to-high cable fly']::text[], 'push', 'weight_reps', null),
  ('pec_deck', null, 'Pec Deck', 'chest', array['machine fly']::text[], 'push', 'weight_reps', null),
  ('chest_press', null, 'Chest Press', 'chest', array['chest press machine']::text[], 'push', 'weight_reps', null),
  ('push_up', null, 'Push-up', 'chest', array['pushup', 'press-up']::text[], 'push', 'bodyweight_reps', 0.64),
  ('dip', null, 'Dip', 'chest', array['chest dip']::text[], 'push', 'weighted_bodyweight', 0.95),
  ('assisted_dip', null, 'Assisted Dip', 'chest', array[]::text[], 'push', 'assisted_bodyweight', 0.95),
  ('deadlift', null, 'Deadlift', 'back', array['conventional deadlift', 'dl']::text[], 'pull', 'weight_reps', null),
  ('sumo_deadlift', null, 'Sumo Deadlift', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('trap_bar_deadlift', null, 'Trap Bar Deadlift', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('romanian_deadlift', null, 'Romanian Deadlift', 'legs', array['rdl']::text[], 'other', 'weight_reps', null),
  ('row', null, 'Row', 'back', array['bent over row', 'bb row', 'one arm row', 'db row', 'barbell row', 'dumbbell row', 'machine row']::text[], 'pull', 'weight_reps', null),
  ('pendlay_row', null, 'Pendlay Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('seated_row', null, 'Seated Row', 'back', array['cable row', 'seated cable row']::text[], 'pull', 'weight_reps', null),
  ('chest_supported_row', null, 'Chest-Supported Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('t_bar_row', null, 'T-Bar Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('inverted_row', null, 'Inverted Row', 'back', array[]::text[], 'pull', 'weighted_bodyweight', 0.55),
  ('pull_up', null, 'Pull-up', 'back', array['pullup']::text[], 'pull', 'weighted_bodyweight', 1),
  ('chin_up', null, 'Chin-up', 'back', array['chinup']::text[], 'pull', 'weighted_bodyweight', 1),
  ('assisted_pull_up', null, 'Assisted Pull-up', 'back', array[]::text[], 'pull', 'assisted_bodyweight', 1),
  ('lat_pulldown', null, 'Lat Pulldown', 'back', array['pulldown']::text[], 'pull', 'weight_reps', null),
  ('close_grip_lat_pulldown', null, 'Close-Grip Lat Pulldown', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('straight_arm_pulldown', null, 'Straight-Arm Pulldown', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('shrug', null, 'Shrug', 'back', array['barbell shrug', 'dumbbell shrug']::text[], 'pull', 'weight_reps', null),
  ('back_extension', null, 'Back Extension', 'back', array['hyperextension']::text[], 'pull', 'weighted_bodyweight', 0.5),
  ('rack_pull', null, 'Rack Pull', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('overhead_press', null, 'Overhead Press', 'shoulders', array['ohp', 'military press', 'standing press']::text[], 'push', 'weight_reps', null),
  ('seated_shoulder_press', null, 'Seated Shoulder Press', 'shoulders', array['db shoulder press', 'seated dumbbell shoulder press']::text[], 'push', 'weight_reps', null),
  ('arnold_press', null, 'Arnold Press', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('shoulder_press', null, 'Shoulder Press', 'shoulders', array['machine shoulder press']::text[], 'push', 'weight_reps', null),
  ('lateral_raise', null, 'Lateral Raise', 'shoulders', array['side raise', 'lat raise', 'dumbbell lateral raise', 'cable lateral raise', 'machine lateral raise']::text[], 'push', 'weight_reps', null),
  ('reverse_fly', null, 'Reverse Fly', 'shoulders', array['rear delt fly', 'reverse chest fly', 'bent over fly', 'reverse dumbbell fly', 'machine reverse fly']::text[], 'push', 'weight_reps', null),
  ('reverse_pec_deck', null, 'Reverse Pec Deck', 'shoulders', array['reverse fly machine']::text[], 'push', 'weight_reps', null),
  ('face_pull', null, 'Face Pull', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('front_raise', null, 'Front Raise', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('upright_row', null, 'Upright Row', 'shoulders', array['cable upright row']::text[], 'push', 'weight_reps', null),
  ('biceps_curl', null, 'Biceps Curl', 'biceps', array['bb curl', 'db curl', 'barbell biceps curl', 'dumbbell biceps curl', 'cable biceps curl']::text[], 'pull', 'weight_reps', null),
  ('incline_curl', null, 'Incline Curl', 'biceps', array['incline dumbbell curl']::text[], 'pull', 'weight_reps', null),
  ('hammer_curl', null, 'Hammer Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('preacher_curl', null, 'Preacher Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('concentration_curl', null, 'Concentration Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('close_grip_bench_press', null, 'Close-Grip Bench Press', 'triceps', array[]::text[], 'push', 'weight_reps', null),
  ('skull_crusher', null, 'Skull Crusher', 'triceps', array['lying triceps extension', 'dumbbell skull crusher']::text[], 'push', 'weight_reps', null),
  ('triceps_pushdown', null, 'Triceps Pushdown', 'triceps', array['tricep pushdown', 'rope pushdown', 'cable triceps pushdown']::text[], 'push', 'weight_reps', null),
  ('overhead_triceps_extension', null, 'Overhead Triceps Extension', 'triceps', array['overhead cable triceps extension', 'dumbbell overhead triceps extension']::text[], 'push', 'weight_reps', null),
  ('triceps_dip', null, 'Triceps Dip', 'triceps', array[]::text[], 'push', 'weighted_bodyweight', 0.9),
  ('wrist_curl', null, 'Wrist Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('reverse_wrist_curl', null, 'Reverse Wrist Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('farmer_carry', null, 'Farmer Carry', 'biceps', array[]::text[], 'pull', 'weight_time', null),
  ('back_squat', null, 'Back Squat', 'legs', array['squat', 'back squat', 'barbell back squat']::text[], 'other', 'weight_reps', null),
  ('front_squat', null, 'Front Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('hack_squat', null, 'Hack Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('leg_press', null, 'Leg Press', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('goblet_squat', null, 'Goblet Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('bulgarian_split_squat', null, 'Bulgarian Split Squat', 'legs', array['bss', 'rear foot elevated split squat']::text[], 'other', 'weight_reps', null),
  ('walking_lunge', null, 'Walking Lunge', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('reverse_lunge', null, 'Reverse Lunge', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('step_up', null, 'Step-up', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('leg_extension', null, 'Leg Extension', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('lying_leg_curl', null, 'Lying Leg Curl', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('seated_leg_curl', null, 'Seated Leg Curl', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('nordic_hamstring_curl', null, 'Nordic Hamstring Curl', 'legs', array[]::text[], 'other', 'bodyweight_reps', 0.6),
  ('hip_thrust', null, 'Hip Thrust', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('glute_bridge', null, 'Glute Bridge', 'legs', array[]::text[], 'other', 'weighted_bodyweight', 0.4),
  ('kickback', null, 'Kickback', 'legs', array['cable kickback']::text[], 'other', 'weight_reps', null),
  ('hip_abduction', null, 'Hip Abduction', 'legs', array['hip abduction machine']::text[], 'other', 'weight_reps', null),
  ('hip_adduction', null, 'Hip Adduction', 'legs', array['hip adduction machine']::text[], 'other', 'weight_reps', null),
  ('standing_calf_raise', null, 'Standing Calf Raise', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('seated_calf_raise', null, 'Seated Calf Raise', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('swing', null, 'Swing', 'legs', array['kettlebell swing']::text[], 'other', 'weight_reps', null),
  ('plank', null, 'Plank', 'core', array[]::text[], 'other', 'time', null),
  ('side_plank', null, 'Side Plank', 'core', array[]::text[], 'other', 'time', null),
  ('hanging_leg_raise', null, 'Hanging Leg Raise', 'core', array[]::text[], 'other', 'weighted_bodyweight', 0.5),
  ('cable_crunch', null, 'Cable Crunch', 'core', array[]::text[], 'other', 'weight_reps', null),
  ('crunch', null, 'Crunch', 'core', array[]::text[], 'other', 'reps_only', null),
  ('russian_twist', null, 'Russian Twist', 'core', array[]::text[], 'other', 'weight_reps', null),
  ('woodchop', null, 'Woodchop', 'core', array['cable woodchop']::text[], 'other', 'weight_reps', null),
  ('ab_wheel_rollout', null, 'Ab Wheel Rollout', 'core', array[]::text[], 'other', 'reps_only', null),
  ('dead_bug', null, 'Dead Bug', 'core', array[]::text[], 'other', 'reps_only', null),
  ('pallof_press', null, 'Pallof Press', 'core', array[]::text[], 'other', 'weight_reps', null),
  ('treadmill_run', null, 'Treadmill Run', 'cardio', array['treadmill']::text[], 'cardio', 'distance_time', null),
  ('outdoor_run', null, 'Outdoor Run', 'cardio', array['run', 'jog']::text[], 'cardio', 'distance_time', null),
  ('treadmill_walk', null, 'Treadmill Walk', 'cardio', array[]::text[], 'cardio', 'distance_time', null),
  ('incline_walk', null, 'Incline Walk', 'cardio', array[]::text[], 'cardio', 'distance_time', null),
  ('stationary_bike', null, 'Stationary Bike', 'cardio', array['bike', 'cycling']::text[], 'cardio', 'distance_time', null),
  ('rowing', null, 'Rowing', 'cardio', array['erg', 'row', 'rowing machine']::text[], 'cardio', 'distance_time', null),
  ('elliptical', null, 'Elliptical', 'cardio', array[]::text[], 'cardio', 'distance_time', null),
  ('stair_climber', null, 'Stair Climber', 'cardio', array['stairmaster']::text[], 'cardio', 'time', null),
  ('swimming', null, 'Swimming', 'cardio', array[]::text[], 'cardio', 'distance_time', null),
  ('jump_rope', null, 'Jump Rope', 'cardio', array[]::text[], 'cardio', 'time', null),
  ('ruck', null, 'Ruck', 'cardio', array[]::text[], 'cardio', 'distance_time', null),
  ('assault_bike', null, 'Assault Bike', 'cardio', array[]::text[], 'cardio', 'time', null),
  ('incline_fly', null, 'Incline Fly', 'chest', array['incline cable fly']::text[], 'push', 'weight_reps', null),
  ('incline_press', null, 'Incline Press', 'chest', array['incline machine press']::text[], 'push', 'weight_reps', null),
  ('svend_press', null, 'Svend Press', 'chest', array[]::text[], 'push', 'weight_reps', null),
  ('wide_grip_pull_up', null, 'Wide-Grip Pull-up', 'back', array['wide pull-up']::text[], 'pull', 'bodyweight_reps', 1),
  ('neutral_grip_pulldown', null, 'Neutral-Grip Pulldown', 'back', array['neutral pulldown']::text[], 'pull', 'weight_reps', null),
  ('single_arm_row', null, 'Single-Arm Row', 'back', array['one arm row', 'single-arm dumbbell row']::text[], 'pull', 'weight_reps', null),
  ('meadows_row', null, 'Meadows Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('seal_row', null, 'Seal Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('pullover', null, 'Pullover', 'back', array['machine pullover']::text[], 'pull', 'weight_reps', null),
  ('good_morning', null, 'Good Morning', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('push_press', null, 'Push Press', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('seated_overhead_press', null, 'Seated Overhead Press', 'shoulders', array['seated ohp', 'seated barbell overhead press']::text[], 'push', 'weight_reps', null),
  ('landmine_press', null, 'Landmine Press', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('rear_delt_fly', null, 'Rear Delt Fly', 'shoulders', array['cable rear delt fly']::text[], 'push', 'weight_reps', null),
  ('leaning_lateral_raise', null, 'Leaning Lateral Raise', 'shoulders', array['leaning cable lateral raise']::text[], 'push', 'weight_reps', null),
  ('plate_front_raise', null, 'Plate Front Raise', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('ez_bar_curl', null, 'EZ-Bar Curl', 'biceps', array['ez curl']::text[], 'pull', 'weight_reps', null),
  ('spider_curl', null, 'Spider Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('rope_hammer_curl', null, 'Rope Hammer Curl', 'biceps', array['cable rope hammer curl']::text[], 'pull', 'weight_reps', null),
  ('bayesian_curl', null, 'Bayesian Curl', 'biceps', array['bayesian cable curl']::text[], 'pull', 'weight_reps', null),
  ('rope_overhead_extension', null, 'Rope Overhead Extension', 'triceps', array['overhead rope extension']::text[], 'push', 'weight_reps', null),
  ('bench_dip', null, 'Bench Dip', 'triceps', array[]::text[], 'push', 'bodyweight_reps', 0.6),
  ('reverse_curl', null, 'Reverse Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('behind_the_back_wrist_curl', null, 'Behind-the-Back Wrist Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('pause_squat', null, 'Pause Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('box_squat', null, 'Box Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('belt_squat', null, 'Belt Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('sissy_squat', null, 'Sissy Squat', 'legs', array[]::text[], 'other', 'bodyweight_reps', 0.7),
  ('single_leg_press', null, 'Single-Leg Press', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('stiff_leg_deadlift', null, 'Stiff-Leg Deadlift', 'legs', array['sldl']::text[], 'other', 'weight_reps', null),
  ('single_leg_romanian_deadlift', null, 'Single-Leg Romanian Deadlift', 'legs', array['single leg rdl']::text[], 'other', 'weight_reps', null),
  ('standing_leg_curl', null, 'Standing Leg Curl', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('pull_through', null, 'Pull-Through', 'legs', array['cable pull-through']::text[], 'other', 'weight_reps', null),
  ('curtsy_lunge', null, 'Curtsy Lunge', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('leg_press_calf_raise', null, 'Leg Press Calf Raise', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('donkey_calf_raise', null, 'Donkey Calf Raise', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('toes_to_bar', null, 'Toes-to-Bar', 'core', array[]::text[], 'other', 'bodyweight_reps', 0.5),
  ('weighted_plank', null, 'Weighted Plank', 'core', array[]::text[], 'other', 'weight_time', null),
  ('decline_sit_up', null, 'Decline Sit-up', 'core', array[]::text[], 'other', 'bodyweight_reps', 0.5),
  ('bicycle_crunch', null, 'Bicycle Crunch', 'core', array[]::text[], 'other', 'reps_only', null),
  ('hanging_knee_raise', null, 'Hanging Knee Raise', 'core', array[]::text[], 'other', 'bodyweight_reps', 0.4),
  ('landmine_rotation', null, 'Landmine Rotation', 'core', array[]::text[], 'other', 'weight_reps', null),
  ('copenhagen_plank', null, 'Copenhagen Plank', 'core', array[]::text[], 'other', 'time', null),
  ('sled_push', null, 'Sled Push', 'cardio', array[]::text[], 'cardio', 'time', null),
  ('battle_ropes', null, 'Battle Ropes', 'cardio', array[]::text[], 'cardio', 'time', null),
  ('box_jump', null, 'Box Jump', 'cardio', array[]::text[], 'cardio', 'reps_only', null),
  ('burpee', null, 'Burpee', 'cardio', array[]::text[], 'cardio', 'reps_only', null),
  ('power_clean', null, 'Power Clean', 'legs', array['clean']::text[], 'other', 'weight_reps', null),
  ('hang_clean', null, 'Hang Clean', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('clean_and_jerk', null, 'Clean and Jerk', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('snatch', null, 'Snatch', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('power_snatch', null, 'Power Snatch', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('clean_pull', null, 'Clean Pull', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('thruster', null, 'Thruster', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('wall_ball', null, 'Wall Ball', 'legs', array[]::text[], 'other', 'reps_only', null),
  ('atlas_stone_lift', null, 'Atlas Stone Lift', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('yoke_carry', null, 'Yoke Carry', 'back', array[]::text[], 'pull', 'weight_time', null),
  ('log_press', null, 'Log Press', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('sandbag_carry', null, 'Sandbag Carry', 'core', array[]::text[], 'other', 'weight_time', null),
  ('suitcase_carry', null, 'Suitcase Carry', 'core', array[]::text[], 'other', 'weight_time', null),
  ('tire_flip', null, 'Tire Flip', 'legs', array[]::text[], 'other', 'reps_only', null),
  ('guillotine_press', null, 'Guillotine Press', 'chest', array[]::text[], 'push', 'weight_reps', null),
  ('floor_press', null, 'Floor Press', 'chest', array[]::text[], 'push', 'weight_reps', null),
  ('deficit_push_up', null, 'Deficit Push-up', 'chest', array[]::text[], 'push', 'bodyweight_reps', 0.7),
  ('pendlay_deficit_row', null, 'Pendlay Deficit Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('kroc_row', null, 'Kroc Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('gorilla_row', null, 'Gorilla Row', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('rope_face_pull', null, 'Rope Face Pull', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('kneeling_lat_pulldown', null, 'Kneeling Lat Pulldown', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('deadlift_snatch_grip', null, 'Deadlift (Snatch Grip)', 'back', array[]::text[], 'pull', 'weight_reps', null),
  ('z_press', null, 'Z Press', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('viking_press', null, 'Viking Press', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('lu_raise', null, 'Lu Raise', 'shoulders', array[]::text[], 'push', 'weight_reps', null),
  ('zottman_curl', null, 'Zottman Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('drag_curl', null, 'Drag Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('cross_body_hammer_curl', null, 'Cross-Body Hammer Curl', 'biceps', array[]::text[], 'pull', 'weight_reps', null),
  ('jm_press', null, 'JM Press', 'triceps', array[]::text[], 'push', 'weight_reps', null),
  ('tate_press', null, 'Tate Press', 'triceps', array[]::text[], 'push', 'weight_reps', null),
  ('diamond_push_up', null, 'Diamond Push-up', 'triceps', array[]::text[], 'push', 'bodyweight_reps', 0.64),
  ('wrist_roller', null, 'Wrist Roller', 'biceps', array[]::text[], 'pull', 'weight_time', null),
  ('zercher_squat', null, 'Zercher Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('landmine_squat', null, 'Landmine Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('pistol_squat', null, 'Pistol Squat', 'legs', array[]::text[], 'other', 'bodyweight_reps', 0.9),
  ('cossack_squat', null, 'Cossack Squat', 'legs', array[]::text[], 'other', 'bodyweight_reps', 0.8),
  ('frog_pump', null, 'Frog Pump', 'legs', array[]::text[], 'other', 'reps_only', null),
  ('kettlebell_goblet_squat', null, 'Kettlebell Goblet Squat', 'legs', array[]::text[], 'other', 'weight_reps', null),
  ('atg_split_squat', null, 'ATG Split Squat', 'legs', array[]::text[], 'other', 'bodyweight_reps', 0.85),
  ('tibialis_raise', null, 'Tibialis Raise', 'legs', array[]::text[], 'other', 'bodyweight_reps', 0.3),
  ('dragon_flag', null, 'Dragon Flag', 'core', array[]::text[], 'other', 'bodyweight_reps', 0.6),
  ('hollow_body_hold', null, 'Hollow Body Hold', 'core', array[]::text[], 'other', 'time', null),
  ('pallof_hold', null, 'Pallof Hold', 'core', array['cable pallof hold']::text[], 'other', 'weight_time', null),
  ('weighted_decline_sit_up', null, 'Weighted Decline Sit-up', 'core', array[]::text[], 'other', 'weight_reps', null),
  ('l_sit', null, 'L-Sit', 'core', array[]::text[], 'other', 'time', null),
  ('mountain_climbers', null, 'Mountain Climbers', 'cardio', array[]::text[], 'cardio', 'time', null),
  ('high_knees', null, 'High Knees', 'cardio', array[]::text[], 'cardio', 'time', null),
  ('ski_erg', null, 'Ski Erg', 'cardio', array[]::text[], 'cardio', 'distance_time', null),
  ('sled_drag', null, 'Sled Drag', 'cardio', array[]::text[], 'cardio', 'time', null),
  ('shadow_boxing', null, 'Shadow Boxing', 'cardio', array[]::text[], 'cardio', 'time', null)
on conflict (id) do nothing;

-- 4. Repoint history off the retired ids, then archive them. Same repoint runs
--    locally in repointRetiredBaseExercises(); this covers rows a device that
--    never opens again would have left behind.
update workout_exercises set exercise_id = 'biceps_curl', updated_at = now()
 where exercise_id = 'curl';
update workout_exercises set exercise_id = 'chest_fly', updated_at = now()
 where exercise_id = 'fly';
update template_exercises set exercise_id = 'biceps_curl', updated_at = now()
 where exercise_id = 'curl';
update template_exercises set exercise_id = 'chest_fly', updated_at = now()
 where exercise_id = 'fly';

-- The merged row inherits the retired row's search aliases, so "dumbbell fly"
-- and "bb curl" still find it.
update exercises target
   set aliases = array(select distinct unnest(target.aliases || retired.aliases)),
       updated_at = now()
  from exercises retired
 where (retired.id = 'curl' and target.id = 'biceps_curl')
    or (retired.id = 'fly' and target.id = 'chest_fly');

update exercises set is_archived = true, updated_at = now()
 where id in ('curl', 'fly') and user_id is null;
