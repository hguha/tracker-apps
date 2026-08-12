/**
 * The system exercise library (§4.3).
 *
 * Each row carries what the app actually uses: a primary muscle, the equipment,
 * and a tracking type that decides which input UI the set row renders.
 *
 * Two fields were removed rather than maintained. **Weighted secondary muscles**
 * spread partial volume credit (bench → front delt at 0.5), which sounded
 * precise but was guesswork per exercise, never surfaced a number anyone acted
 * on, and made adding an exercise a research task. **Movement pattern** is now
 * derived from the primary muscle (`domain/movement.ts`) instead of hand-tagged
 * per row — the only distinctions the app needs are cardio and push/pull.
 *
 * `bodyweightFactor` is the fraction of bodyweight the movement actually
 * lifts — without it, a set of pull-ups registers as zero load.
 */

import type { Equipment, TrackingType } from '@/domain/types'

export interface ExerciseSeed {
  name: string
  primary: string
  equipment: Equipment
  /** Defaults to `weight_reps`, which covers most of the library. */
  tracking?: TrackingType
  bodyweightFactor?: number
  unilateral?: boolean
  aliases?: string[]
}

export const EXERCISE_SEEDS: ExerciseSeed[] = [
  // ---------------------------------------------------------------- chest
  {
    name: 'Barbell Bench Press',
    primary: 'mid_chest',
    equipment: 'barbell',
    aliases: ['bench', 'flat bench', 'bb bench'],
  },
  {
    name: 'Incline Barbell Bench Press',
    primary: 'upper_chest',
    equipment: 'barbell',
    aliases: ['incline bench'],
  },
  {
    name: 'Decline Barbell Bench Press',
    primary: 'lower_chest',
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Bench Press',
    primary: 'mid_chest',
    equipment: 'dumbbell',
    aliases: ['db bench'],
  },
  {
    name: 'Incline Dumbbell Bench Press',
    primary: 'upper_chest',
    equipment: 'dumbbell',
    aliases: ['incline db press'],
  },
  {
    name: 'Dumbbell Fly',
    primary: 'mid_chest',
    equipment: 'dumbbell',
  },
  {
    name: 'Cable Fly',
    primary: 'mid_chest',
    equipment: 'cable',
    aliases: ['cable crossover'],
  },
  {
    name: 'Low-to-High Cable Fly',
    primary: 'upper_chest',
    equipment: 'cable',
  },
  {
    name: 'Pec Deck',
    primary: 'mid_chest',
    equipment: 'machine',
    aliases: ['machine fly'],
  },
  {
    name: 'Chest Press Machine',
    primary: 'mid_chest',
    equipment: 'machine',
  },
  {
    name: 'Smith Machine Bench Press',
    primary: 'mid_chest',
    equipment: 'smith',
  },
  {
    name: 'Push-up',
    primary: 'mid_chest',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.64,
    aliases: ['pushup', 'press-up'],
  },
  {
    name: 'Dip',
    primary: 'lower_chest',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.95,
    aliases: ['chest dip'],
  },
  {
    name: 'Assisted Dip',
    primary: 'lower_chest',
    equipment: 'machine',
    tracking: 'assisted_bodyweight',
    bodyweightFactor: 0.95,
  },

  // ----------------------------------------------------------------- back
  {
    name: 'Deadlift',
    primary: 'erectors',
    equipment: 'barbell',
    aliases: ['conventional deadlift', 'dl'],
  },
  {
    name: 'Sumo Deadlift',
    primary: 'glutes',
    equipment: 'barbell',
  },
  {
    name: 'Trap Bar Deadlift',
    primary: 'quads',
    equipment: 'barbell',
  },
  {
    name: 'Romanian Deadlift',
    primary: 'hamstrings',
    equipment: 'barbell',
    aliases: ['rdl'],
  },
  {
    name: 'Barbell Row',
    primary: 'lats',
    equipment: 'barbell',
    aliases: ['bent over row', 'bb row'],
  },
  {
    name: 'Pendlay Row',
    primary: 'lats',
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Row',
    primary: 'lats',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['one arm row', 'db row'],
  },
  {
    name: 'Seated Cable Row',
    primary: 'lats',
    equipment: 'cable',
    aliases: ['cable row'],
  },
  {
    name: 'Chest-Supported Row',
    primary: 'rhomboids',
    equipment: 'machine',
  },
  {
    name: 'T-Bar Row',
    primary: 'lats',
    equipment: 'barbell',
  },
  {
    name: 'Inverted Row',
    primary: 'lats',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.55,
  },
  {
    name: 'Pull-up',
    primary: 'lats',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 1.0,
    aliases: ['pullup'],
  },
  {
    name: 'Chin-up',
    primary: 'lats',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 1.0,
    aliases: ['chinup'],
  },
  {
    name: 'Assisted Pull-up',
    primary: 'lats',
    equipment: 'machine',
    tracking: 'assisted_bodyweight',
    bodyweightFactor: 1.0,
  },
  {
    name: 'Lat Pulldown',
    primary: 'lats',
    equipment: 'cable',
    aliases: ['pulldown'],
  },
  {
    name: 'Close-Grip Lat Pulldown',
    primary: 'lats',
    equipment: 'cable',
  },
  {
    name: 'Straight-Arm Pulldown',
    primary: 'lats',
    equipment: 'cable',
  },
  {
    name: 'Barbell Shrug',
    primary: 'upper_traps',
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Shrug',
    primary: 'upper_traps',
    equipment: 'dumbbell',
  },
  {
    name: 'Back Extension',
    primary: 'erectors',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.5,
    aliases: ['hyperextension'],
  },
  {
    name: 'Rack Pull',
    primary: 'erectors',
    equipment: 'barbell',
  },

  // ------------------------------------------------------------ shoulders
  {
    name: 'Overhead Press',
    primary: 'front_delt',
    equipment: 'barbell',
    aliases: ['ohp', 'military press', 'standing press'],
  },
  {
    name: 'Seated Dumbbell Shoulder Press',
    primary: 'front_delt',
    equipment: 'dumbbell',
    aliases: ['db shoulder press'],
  },
  {
    name: 'Arnold Press',
    primary: 'front_delt',
    equipment: 'dumbbell',
  },
  {
    name: 'Machine Shoulder Press',
    primary: 'front_delt',
    equipment: 'machine',
  },
  {
    name: 'Dumbbell Lateral Raise',
    primary: 'side_delt',
    equipment: 'dumbbell',
    aliases: ['side raise', 'lat raise'],
  },
  {
    name: 'Cable Lateral Raise',
    primary: 'side_delt',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Machine Lateral Raise',
    primary: 'side_delt',
    equipment: 'machine',
  },
  {
    name: 'Reverse Dumbbell Fly',
    primary: 'rear_delt',
    equipment: 'dumbbell',
    aliases: ['rear delt fly', 'reverse chest fly', 'bent over fly'],
  },
  {
    name: 'Reverse Pec Deck',
    primary: 'rear_delt',
    equipment: 'machine',
    aliases: ['reverse fly machine'],
  },
  {
    name: 'Face Pull',
    primary: 'rear_delt',
    equipment: 'cable',
  },
  {
    name: 'Front Raise',
    primary: 'front_delt',
    equipment: 'dumbbell',
  },
  {
    name: 'Upright Row',
    primary: 'side_delt',
    equipment: 'barbell',
  },

  // ----------------------------------------------------------------- arms
  {
    name: 'Barbell Curl',
    primary: 'biceps',
    equipment: 'barbell',
    aliases: ['bb curl'],
  },
  {
    name: 'Dumbbell Curl',
    primary: 'biceps',
    equipment: 'dumbbell',
    aliases: ['db curl'],
  },
  {
    name: 'Incline Dumbbell Curl',
    primary: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Hammer Curl',
    primary: 'brachialis',
    equipment: 'dumbbell',
  },
  {
    name: 'Preacher Curl',
    primary: 'biceps',
    equipment: 'barbell',
  },
  {
    name: 'Cable Curl',
    primary: 'biceps',
    equipment: 'cable',
  },
  {
    name: 'Concentration Curl',
    primary: 'biceps',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Close-Grip Bench Press',
    primary: 'triceps',
    equipment: 'barbell',
  },
  {
    name: 'Skull Crusher',
    primary: 'triceps',
    equipment: 'barbell',
    aliases: ['lying triceps extension'],
  },
  {
    name: 'Cable Triceps Pushdown',
    primary: 'triceps',
    equipment: 'cable',
    aliases: ['tricep pushdown', 'rope pushdown'],
  },
  {
    name: 'Overhead Cable Triceps Extension',
    primary: 'triceps',
    equipment: 'cable',
  },
  {
    name: 'Dumbbell Overhead Triceps Extension',
    primary: 'triceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Triceps Dip',
    primary: 'triceps',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.9,
  },
  {
    name: 'Wrist Curl',
    primary: 'forearms',
    equipment: 'dumbbell',
  },
  {
    name: 'Reverse Wrist Curl',
    primary: 'forearms',
    equipment: 'dumbbell',
  },
  {
    name: 'Farmer Carry',
    primary: 'forearms',
    equipment: 'dumbbell',
    tracking: 'weight_time',
  },

  // ----------------------------------------------------------------- legs
  {
    name: 'Barbell Back Squat',
    primary: 'quads',
    equipment: 'barbell',
    aliases: ['squat', 'back squat'],
  },
  {
    name: 'Front Squat',
    primary: 'quads',
    equipment: 'barbell',
  },
  {
    name: 'Hack Squat',
    primary: 'quads',
    equipment: 'machine',
  },
  {
    name: 'Leg Press',
    primary: 'quads',
    equipment: 'machine',
  },
  {
    name: 'Goblet Squat',
    primary: 'quads',
    equipment: 'kettlebell',
  },
  {
    name: 'Bulgarian Split Squat',
    primary: 'quads',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['bss', 'rear foot elevated split squat'],
  },
  {
    name: 'Walking Lunge',
    primary: 'quads',
    equipment: 'dumbbell',
  },
  {
    name: 'Reverse Lunge',
    primary: 'glutes',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Step-up',
    primary: 'quads',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Leg Extension',
    primary: 'quads',
    equipment: 'machine',
  },
  {
    name: 'Lying Leg Curl',
    primary: 'hamstrings',
    equipment: 'machine',
  },
  {
    name: 'Seated Leg Curl',
    primary: 'hamstrings',
    equipment: 'machine',
  },
  {
    name: 'Nordic Hamstring Curl',
    primary: 'hamstrings',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.6,
  },
  {
    name: 'Hip Thrust',
    primary: 'glutes',
    equipment: 'barbell',
  },
  {
    name: 'Glute Bridge',
    primary: 'glutes',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.4,
  },
  {
    name: 'Cable Kickback',
    primary: 'glutes',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Hip Abduction Machine',
    primary: 'abductors',
    equipment: 'machine',
  },
  {
    name: 'Hip Adduction Machine',
    primary: 'adductors',
    equipment: 'machine',
  },
  {
    name: 'Standing Calf Raise',
    primary: 'calves',
    equipment: 'machine',
  },
  {
    name: 'Seated Calf Raise',
    primary: 'calves',
    equipment: 'machine',
  },
  {
    name: 'Kettlebell Swing',
    primary: 'glutes',
    equipment: 'kettlebell',
  },

  // ----------------------------------------------------------------- core
  {
    name: 'Plank',
    primary: 'transverse_abdominis',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'Side Plank',
    primary: 'obliques',
    equipment: 'bodyweight',
    tracking: 'time',
    unilateral: true,
  },
  {
    name: 'Hanging Leg Raise',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.5,
  },
  {
    name: 'Cable Crunch',
    primary: 'rectus_abdominis',
    equipment: 'cable',
  },
  {
    name: 'Crunch',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Russian Twist',
    primary: 'obliques',
    equipment: 'other',
  },
  {
    name: 'Cable Woodchop',
    primary: 'obliques',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Ab Wheel Rollout',
    primary: 'rectus_abdominis',
    equipment: 'other',
    tracking: 'reps_only',
  },
  {
    name: 'Dead Bug',
    primary: 'transverse_abdominis',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Pallof Press',
    primary: 'obliques',
    equipment: 'cable',
    unilateral: true,
  },

  // --------------------------------------------------------------- cardio
  // distance_time gets a distance + duration input; time alone gets a timer.
  {
    name: 'Treadmill Run',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'distance_time',
    aliases: ['treadmill'],
  },
  {
    name: 'Outdoor Run',
    primary: 'cardiovascular',
    equipment: 'other',
    tracking: 'distance_time',
    aliases: ['run', 'jog'],
  },
  {
    name: 'Treadmill Walk',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Incline Walk',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Stationary Bike',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'distance_time',
    aliases: ['bike', 'cycling'],
  },
  {
    name: 'Rowing Machine',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'distance_time',
    aliases: ['erg', 'row'],
  },
  {
    name: 'Elliptical',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Stair Climber',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'time',
    aliases: ['stairmaster'],
  },
  {
    name: 'Swimming',
    primary: 'cardiovascular',
    equipment: 'other',
    tracking: 'distance_time',
  },
  {
    name: 'Jump Rope',
    primary: 'cardiovascular',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Ruck',
    primary: 'cardiovascular',
    equipment: 'other',
    tracking: 'distance_time',
  },
  {
    name: 'Assault Bike',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'time',
  },

  // ---------------------------------------------------------- chest (more)
  {
    name: 'Machine Chest Fly',
    primary: 'mid_chest',
    equipment: 'machine',
  },
  {
    name: 'Incline Cable Fly',
    primary: 'upper_chest',
    equipment: 'cable',
  },
  {
    name: 'Incline Machine Press',
    primary: 'upper_chest',
    equipment: 'machine',
  },
  {
    name: 'Svend Press',
    primary: 'mid_chest',
    equipment: 'other',
  },

  // ------------------------------------------------------------- back (more)
  {
    name: 'Wide-Grip Pull-up',
    primary: 'lats',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 1.0,
    aliases: ['wide pull-up'],
  },
  {
    name: 'Neutral-Grip Pulldown',
    primary: 'lats',
    equipment: 'cable',
    aliases: ['neutral pulldown'],
  },
  {
    name: 'Single-Arm Dumbbell Row',
    primary: 'lats',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['one arm row'],
  },
  {
    name: 'Meadows Row',
    primary: 'lats',
    equipment: 'barbell',
    unilateral: true,
  },
  {
    name: 'Seal Row',
    primary: 'mid_traps',
    equipment: 'barbell',
  },
  {
    name: 'Machine Row',
    primary: 'lats',
    equipment: 'machine',
  },
  {
    name: 'Machine Pullover',
    primary: 'lats',
    equipment: 'machine',
  },
  {
    name: 'Good Morning',
    primary: 'hamstrings',
    equipment: 'barbell',
  },

  // -------------------------------------------------------- shoulders (more)
  {
    name: 'Push Press',
    primary: 'front_delt',
    equipment: 'barbell',
  },
  {
    name: 'Seated Barbell Overhead Press',
    primary: 'front_delt',
    equipment: 'barbell',
    aliases: ['seated ohp'],
  },
  {
    name: 'Landmine Press',
    primary: 'front_delt',
    equipment: 'barbell',
    unilateral: true,
  },
  {
    name: 'Cable Rear Delt Fly',
    primary: 'rear_delt',
    equipment: 'cable',
  },
  {
    name: 'Leaning Cable Lateral Raise',
    primary: 'side_delt',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Plate Front Raise',
    primary: 'front_delt',
    equipment: 'other',
  },

  // ------------------------------------------------------------- arms (more)
  {
    name: 'EZ-Bar Curl',
    primary: 'biceps',
    equipment: 'barbell',
    aliases: ['ez curl'],
  },
  {
    name: 'Spider Curl',
    primary: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Cable Rope Hammer Curl',
    primary: 'brachialis',
    equipment: 'cable',
  },
  {
    name: 'Bayesian Cable Curl',
    primary: 'biceps',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Dumbbell Skull Crusher',
    primary: 'triceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Rope Overhead Extension',
    primary: 'triceps',
    equipment: 'cable',
    aliases: ['overhead rope extension'],
  },
  {
    name: 'Bench Dip',
    primary: 'triceps',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.6,
  },
  {
    name: 'Reverse Curl',
    primary: 'brachialis',
    equipment: 'barbell',
  },
  {
    name: 'Behind-the-Back Wrist Curl',
    primary: 'forearms',
    equipment: 'barbell',
  },

  // ------------------------------------------------------------- legs (more)
  {
    name: 'Pause Squat',
    primary: 'quads',
    equipment: 'barbell',
  },
  {
    name: 'Box Squat',
    primary: 'quads',
    equipment: 'barbell',
  },
  {
    name: 'Belt Squat',
    primary: 'quads',
    equipment: 'machine',
  },
  {
    name: 'Sissy Squat',
    primary: 'quads',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.7,
  },
  {
    name: 'Single-Leg Press',
    primary: 'quads',
    equipment: 'machine',
    unilateral: true,
  },
  {
    name: 'Stiff-Leg Deadlift',
    primary: 'hamstrings',
    equipment: 'barbell',
    aliases: ['sldl'],
  },
  {
    name: 'Single-Leg Romanian Deadlift',
    primary: 'hamstrings',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['single leg rdl'],
  },
  {
    name: 'Standing Leg Curl',
    primary: 'hamstrings',
    equipment: 'machine',
    unilateral: true,
  },
  {
    name: 'Cable Pull-Through',
    primary: 'glutes',
    equipment: 'cable',
  },
  {
    name: 'Curtsy Lunge',
    primary: 'glutes',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Leg Press Calf Raise',
    primary: 'calves',
    equipment: 'machine',
  },
  {
    name: 'Donkey Calf Raise',
    primary: 'calves',
    equipment: 'machine',
  },

  // ------------------------------------------------------------- core (more)
  {
    name: 'Toes-to-Bar',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.5,
  },
  {
    name: 'Weighted Plank',
    primary: 'transverse_abdominis',
    equipment: 'other',
    tracking: 'weight_time',
  },
  {
    name: 'Decline Sit-up',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.5,
  },
  {
    name: 'Bicycle Crunch',
    primary: 'obliques',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Hanging Knee Raise',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.4,
  },
  {
    name: 'Landmine Rotation',
    primary: 'obliques',
    equipment: 'barbell',
  },
  {
    name: 'Copenhagen Plank',
    primary: 'obliques',
    equipment: 'bodyweight',
    tracking: 'time',
  },

  // --------------------------------------------------------- cardio (more)
  {
    name: 'Sled Push',
    primary: 'cardiovascular',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Battle Ropes',
    primary: 'cardiovascular',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Box Jump',
    primary: 'cardiovascular',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Burpee',
    primary: 'cardiovascular',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },

  // ---------------------------------------------------- olympic / power
  {
    name: 'Power Clean',
    primary: 'glutes',
    equipment: 'barbell',
    aliases: ['clean'],
  },
  {
    name: 'Hang Clean',
    primary: 'glutes',
    equipment: 'barbell',
  },
  {
    name: 'Clean and Jerk',
    primary: 'glutes',
    equipment: 'barbell',
  },
  {
    name: 'Snatch',
    primary: 'glutes',
    equipment: 'barbell',
  },
  {
    name: 'Power Snatch',
    primary: 'upper_traps',
    equipment: 'barbell',
  },
  {
    name: 'Clean Pull',
    primary: 'upper_traps',
    equipment: 'barbell',
  },
  {
    name: 'Thruster',
    primary: 'quads',
    equipment: 'barbell',
  },
  {
    name: 'Wall Ball',
    primary: 'quads',
    equipment: 'other',
    tracking: 'reps_only',
  },

  // ---------------------------------------------------- strongman
  {
    name: 'Atlas Stone Lift',
    primary: 'erectors',
    equipment: 'other',
  },
  {
    name: 'Yoke Carry',
    primary: 'erectors',
    equipment: 'other',
    tracking: 'weight_time',
  },
  {
    name: 'Log Press',
    primary: 'front_delt',
    equipment: 'other',
  },
  {
    name: 'Sandbag Carry',
    primary: 'transverse_abdominis',
    equipment: 'other',
    tracking: 'weight_time',
  },
  {
    name: 'Suitcase Carry',
    primary: 'obliques',
    equipment: 'dumbbell',
    tracking: 'weight_time',
    unilateral: true,
  },
  {
    name: 'Tire Flip',
    primary: 'glutes',
    equipment: 'other',
    tracking: 'reps_only',
  },

  // ---------------------------------------------------- chest (more)
  {
    name: 'Guillotine Press',
    primary: 'upper_chest',
    equipment: 'barbell',
  },
  {
    name: 'Floor Press',
    primary: 'mid_chest',
    equipment: 'barbell',
  },
  {
    name: 'Deficit Push-up',
    primary: 'mid_chest',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.7,
  },

  // ---------------------------------------------------- back (more)
  {
    name: 'Pendlay Deficit Row',
    primary: 'lats',
    equipment: 'barbell',
  },
  {
    name: 'Kroc Row',
    primary: 'lats',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Gorilla Row',
    primary: 'lats',
    equipment: 'kettlebell',
    unilateral: true,
  },
  {
    name: 'Rope Face Pull',
    primary: 'rear_delt',
    equipment: 'cable',
  },
  {
    name: 'Kneeling Lat Pulldown',
    primary: 'lats',
    equipment: 'cable',
  },
  {
    name: 'Deadlift (Snatch Grip)',
    primary: 'erectors',
    equipment: 'barbell',
  },

  // ---------------------------------------------------- shoulders (more)
  {
    name: 'Z Press',
    primary: 'front_delt',
    equipment: 'barbell',
  },
  {
    name: 'Viking Press',
    primary: 'front_delt',
    equipment: 'machine',
  },
  {
    name: 'Cable Upright Row',
    primary: 'side_delt',
    equipment: 'cable',
  },
  {
    name: 'Machine Reverse Fly',
    primary: 'rear_delt',
    equipment: 'machine',
  },
  {
    name: 'Lu Raise',
    primary: 'side_delt',
    equipment: 'dumbbell',
  },

  // ---------------------------------------------------- arms (more)
  {
    name: 'Zottman Curl',
    primary: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Drag Curl',
    primary: 'biceps',
    equipment: 'barbell',
  },
  {
    name: 'Cross-Body Hammer Curl',
    primary: 'brachialis',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'JM Press',
    primary: 'triceps',
    equipment: 'barbell',
  },
  {
    name: 'Tate Press',
    primary: 'triceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Diamond Push-up',
    primary: 'triceps',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.64,
  },
  {
    name: 'Wrist Roller',
    primary: 'forearms',
    equipment: 'other',
    tracking: 'weight_time',
  },

  // ---------------------------------------------------- legs (more)
  {
    name: 'Zercher Squat',
    primary: 'quads',
    equipment: 'barbell',
  },
  {
    name: 'Landmine Squat',
    primary: 'quads',
    equipment: 'barbell',
  },
  {
    name: 'Pistol Squat',
    primary: 'quads',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.9,
    unilateral: true,
  },
  {
    name: 'Cossack Squat',
    primary: 'adductors',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.8,
    unilateral: true,
  },
  {
    name: 'Frog Pump',
    primary: 'glutes',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Kettlebell Goblet Squat',
    primary: 'quads',
    equipment: 'kettlebell',
  },
  {
    name: 'ATG Split Squat',
    primary: 'quads',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.85,
    unilateral: true,
  },
  {
    name: 'Tibialis Raise',
    primary: 'calves',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.3,
  },

  // ---------------------------------------------------- core (more)
  {
    name: 'Dragon Flag',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.6,
  },
  {
    name: 'Hollow Body Hold',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'Cable Pallof Hold',
    primary: 'obliques',
    equipment: 'cable',
    tracking: 'weight_time',
  },
  {
    name: 'Weighted Decline Sit-up',
    primary: 'rectus_abdominis',
    equipment: 'other',
  },
  {
    name: 'L-Sit',
    primary: 'rectus_abdominis',
    equipment: 'bodyweight',
    tracking: 'time',
  },

  // ---------------------------------------------------- cardio (more)
  {
    name: 'Mountain Climbers',
    primary: 'cardiovascular',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'High Knees',
    primary: 'cardiovascular',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'Ski Erg',
    primary: 'cardiovascular',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Sled Drag',
    primary: 'cardiovascular',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Shadow Boxing',
    primary: 'cardiovascular',
    equipment: 'bodyweight',
    tracking: 'time',
  },
]
