/**
 * The system exercise library (§4.3).
 *
 * Each row carries what the app actually uses: the body region it trains, the
 * equipment, and a tracking type that decides which input UI the set row renders.
 *
 * Three things were removed rather than maintained. **Weighted secondary
 * muscles** spread partial volume credit (bench → front delt at 0.5), which
 * sounded precise but was guesswork per exercise and never surfaced a number
 * anyone acted on. **Movement pattern** is derived from the region
 * (`domain/movement.ts`) instead of hand-tagged per row. And the **specific
 * muscle** below the region (Front Delt vs Rear Delt) was a second taxonomy to
 * maintain and choose from that nothing in the app read: every chart, the coach,
 * and the avatar all aggregate by region, so the region is what rows store.
 *
 * `bodyweightFactor` is the fraction of bodyweight the movement actually
 * lifts — without it, a set of pull-ups registers as zero load.
 */

import type { Equipment, Region, TrackingType } from '@/domain/types'

export interface ExerciseSeed {
  name: string
  region: Region
  equipment: Equipment
  /** Defaults to `weight_reps`, which covers most of the library. */
  tracking?: TrackingType
  bodyweightFactor?: number
  unilateral?: boolean
  aliases?: string[]
  /**
   * Grouping label, defaulting to `movementFor(name)`. Set explicitly only when
   * the derivation would group this row wrongly — e.g. to keep a weighted "Cable
   * Crunch" out of the bodyweight "Crunch" movement.
   */
  movement?: string
}

export const EXERCISE_SEEDS: ExerciseSeed[] = [
  // ---------------------------------------------------------------- chest
  {
    name: 'Barbell Bench Press',
    region: 'chest',
    equipment: 'barbell',
    aliases: ['bench', 'flat bench', 'bb bench'],
  },
  {
    name: 'Incline Barbell Bench Press',
    region: 'chest',
    equipment: 'barbell',
    aliases: ['incline bench'],
  },
  {
    name: 'Decline Barbell Bench Press',
    region: 'chest',
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Bench Press',
    region: 'chest',
    equipment: 'dumbbell',
    aliases: ['db bench'],
  },
  {
    name: 'Incline Dumbbell Bench Press',
    region: 'chest',
    equipment: 'dumbbell',
    aliases: ['incline db press'],
  },
  {
    name: 'Dumbbell Chest Fly',
    region: 'chest',
    equipment: 'dumbbell',
  },
  {
    name: 'Cable Chest Fly',
    region: 'chest',
    equipment: 'cable',
    aliases: ['cable crossover'],
  },
  {
    name: 'Low-to-High Cable Fly',
    region: 'chest',
    equipment: 'cable',
  },
  {
    name: 'Pec Deck',
    region: 'chest',
    equipment: 'machine',
    aliases: ['machine fly'],
  },
  {
    name: 'Chest Press Machine',
    region: 'chest',
    equipment: 'machine',
  },
  {
    name: 'Smith Machine Bench Press',
    region: 'chest',
    equipment: 'smith',
  },
  {
    name: 'Push-up',
    region: 'chest',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.64,
    aliases: ['pushup', 'press-up'],
  },
  {
    name: 'Dip',
    region: 'chest',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.95,
    aliases: ['chest dip'],
  },
  {
    name: 'Assisted Dip',
    region: 'chest',
    equipment: 'machine',
    tracking: 'assisted_bodyweight',
    bodyweightFactor: 0.95,
  },

  // ----------------------------------------------------------------- back
  {
    name: 'Deadlift',
    region: 'back',
    equipment: 'barbell',
    aliases: ['conventional deadlift', 'dl'],
  },
  {
    name: 'Sumo Deadlift',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Trap Bar Deadlift',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Romanian Deadlift',
    region: 'legs',
    equipment: 'barbell',
    aliases: ['rdl'],
  },
  {
    name: 'Barbell Row',
    region: 'back',
    equipment: 'barbell',
    aliases: ['bent over row', 'bb row'],
  },
  {
    name: 'Pendlay Row',
    region: 'back',
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Row',
    region: 'back',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['one arm row', 'db row'],
  },
  {
    name: 'Seated Cable Row',
    region: 'back',
    equipment: 'cable',
    aliases: ['cable row'],
  },
  {
    name: 'Chest-Supported Row',
    region: 'back',
    equipment: 'machine',
  },
  {
    name: 'T-Bar Row',
    region: 'back',
    equipment: 'barbell',
  },
  {
    name: 'Inverted Row',
    region: 'back',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.55,
  },
  {
    name: 'Pull-up',
    region: 'back',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 1.0,
    aliases: ['pullup'],
  },
  {
    name: 'Chin-up',
    region: 'back',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 1.0,
    aliases: ['chinup'],
  },
  {
    name: 'Assisted Pull-up',
    region: 'back',
    equipment: 'machine',
    tracking: 'assisted_bodyweight',
    bodyweightFactor: 1.0,
  },
  {
    name: 'Lat Pulldown',
    region: 'back',
    equipment: 'cable',
    aliases: ['pulldown'],
  },
  {
    name: 'Close-Grip Lat Pulldown',
    region: 'back',
    equipment: 'cable',
  },
  {
    name: 'Straight-Arm Pulldown',
    region: 'back',
    equipment: 'cable',
  },
  {
    name: 'Barbell Shrug',
    region: 'back',
    equipment: 'barbell',
  },
  {
    name: 'Dumbbell Shrug',
    region: 'back',
    equipment: 'dumbbell',
  },
  {
    name: 'Back Extension',
    region: 'back',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.5,
    aliases: ['hyperextension'],
  },
  {
    name: 'Rack Pull',
    region: 'back',
    equipment: 'barbell',
  },

  // ------------------------------------------------------------ shoulders
  {
    name: 'Overhead Press',
    region: 'shoulders',
    equipment: 'barbell',
    aliases: ['ohp', 'military press', 'standing press'],
  },
  {
    name: 'Seated Dumbbell Shoulder Press',
    region: 'shoulders',
    equipment: 'dumbbell',
    aliases: ['db shoulder press'],
  },
  {
    name: 'Arnold Press',
    region: 'shoulders',
    equipment: 'dumbbell',
  },
  {
    name: 'Machine Shoulder Press',
    region: 'shoulders',
    equipment: 'machine',
  },
  {
    name: 'Dumbbell Lateral Raise',
    region: 'shoulders',
    equipment: 'dumbbell',
    aliases: ['side raise', 'lat raise'],
  },
  {
    name: 'Cable Lateral Raise',
    region: 'shoulders',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Machine Lateral Raise',
    region: 'shoulders',
    equipment: 'machine',
  },
  {
    name: 'Reverse Dumbbell Fly',
    region: 'shoulders',
    equipment: 'dumbbell',
    aliases: ['rear delt fly', 'reverse chest fly', 'bent over fly'],
  },
  {
    name: 'Reverse Pec Deck',
    region: 'shoulders',
    equipment: 'machine',
    aliases: ['reverse fly machine'],
  },
  {
    name: 'Face Pull',
    region: 'shoulders',
    equipment: 'cable',
  },
  {
    name: 'Front Raise',
    region: 'shoulders',
    equipment: 'dumbbell',
  },
  {
    name: 'Upright Row',
    region: 'shoulders',
    equipment: 'barbell',
  },

  // ----------------------------------------------------------------- arms
  {
    name: 'Barbell Biceps Curl',
    region: 'biceps',
    equipment: 'barbell',
    aliases: ['bb curl'],
  },
  {
    name: 'Dumbbell Biceps Curl',
    region: 'biceps',
    equipment: 'dumbbell',
    aliases: ['db curl'],
  },
  {
    name: 'Incline Dumbbell Curl',
    region: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Hammer Curl',
    region: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Preacher Curl',
    region: 'biceps',
    equipment: 'barbell',
  },
  {
    name: 'Cable Biceps Curl',
    region: 'biceps',
    equipment: 'cable',
  },
  {
    name: 'Concentration Curl',
    region: 'biceps',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Close-Grip Bench Press',
    region: 'triceps',
    equipment: 'barbell',
  },
  {
    name: 'Skull Crusher',
    region: 'triceps',
    equipment: 'barbell',
    aliases: ['lying triceps extension'],
  },
  {
    name: 'Cable Triceps Pushdown',
    region: 'triceps',
    equipment: 'cable',
    aliases: ['tricep pushdown', 'rope pushdown'],
  },
  {
    name: 'Overhead Cable Triceps Extension',
    region: 'triceps',
    equipment: 'cable',
  },
  {
    name: 'Dumbbell Overhead Triceps Extension',
    region: 'triceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Triceps Dip',
    region: 'triceps',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.9,
  },
  {
    name: 'Wrist Curl',
    region: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Reverse Wrist Curl',
    region: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Farmer Carry',
    region: 'biceps',
    equipment: 'dumbbell',
    tracking: 'weight_time',
  },

  // ----------------------------------------------------------------- legs
  {
    name: 'Barbell Back Squat',
    region: 'legs',
    equipment: 'barbell',
    aliases: ['squat', 'back squat'],
  },
  {
    name: 'Front Squat',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Hack Squat',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Leg Press',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Goblet Squat',
    region: 'legs',
    equipment: 'kettlebell',
  },
  {
    name: 'Bulgarian Split Squat',
    region: 'legs',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['bss', 'rear foot elevated split squat'],
  },
  {
    name: 'Walking Lunge',
    region: 'legs',
    equipment: 'dumbbell',
  },
  {
    name: 'Reverse Lunge',
    region: 'legs',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Step-up',
    region: 'legs',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Leg Extension',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Lying Leg Curl',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Seated Leg Curl',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Nordic Hamstring Curl',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.6,
  },
  {
    name: 'Hip Thrust',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Glute Bridge',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.4,
  },
  {
    name: 'Cable Kickback',
    region: 'legs',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Hip Abduction Machine',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Hip Adduction Machine',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Standing Calf Raise',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Seated Calf Raise',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Kettlebell Swing',
    region: 'legs',
    equipment: 'kettlebell',
  },

  // ----------------------------------------------------------------- core
  {
    name: 'Plank',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'Side Plank',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'time',
    unilateral: true,
  },
  {
    name: 'Hanging Leg Raise',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'weighted_bodyweight',
    bodyweightFactor: 0.5,
  },
  {
    name: 'Cable Crunch',
    region: 'core',
    equipment: 'cable',
    // A weighted cable movement, not the same lift as a floor Crunch.
    movement: 'Cable Crunch',
  },
  {
    name: 'Crunch',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Russian Twist',
    region: 'core',
    equipment: 'other',
  },
  {
    name: 'Cable Woodchop',
    region: 'core',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Ab Wheel Rollout',
    region: 'core',
    equipment: 'other',
    tracking: 'reps_only',
  },
  {
    name: 'Dead Bug',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Pallof Press',
    region: 'core',
    equipment: 'cable',
    unilateral: true,
  },

  // --------------------------------------------------------------- cardio
  // distance_time gets a distance + duration input; time alone gets a timer.
  {
    name: 'Treadmill Run',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'distance_time',
    aliases: ['treadmill'],
  },
  {
    name: 'Outdoor Run',
    region: 'cardio',
    equipment: 'other',
    tracking: 'distance_time',
    aliases: ['run', 'jog'],
  },
  {
    name: 'Treadmill Walk',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Incline Walk',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Stationary Bike',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'distance_time',
    aliases: ['bike', 'cycling'],
  },
  {
    name: 'Rowing Machine',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'distance_time',
    aliases: ['erg', 'row'],
  },
  {
    name: 'Elliptical',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Stair Climber',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'time',
    aliases: ['stairmaster'],
  },
  {
    name: 'Swimming',
    region: 'cardio',
    equipment: 'other',
    tracking: 'distance_time',
  },
  {
    name: 'Jump Rope',
    region: 'cardio',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Ruck',
    region: 'cardio',
    equipment: 'other',
    tracking: 'distance_time',
  },
  {
    name: 'Assault Bike',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'time',
  },

  // ---------------------------------------------------------- chest (more)
  {
    name: 'Machine Chest Fly',
    region: 'chest',
    equipment: 'machine',
  },
  {
    name: 'Incline Cable Fly',
    region: 'chest',
    equipment: 'cable',
  },
  {
    name: 'Incline Machine Press',
    region: 'chest',
    equipment: 'machine',
  },
  {
    name: 'Svend Press',
    region: 'chest',
    equipment: 'other',
  },

  // ------------------------------------------------------------- back (more)
  {
    name: 'Wide-Grip Pull-up',
    region: 'back',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 1.0,
    aliases: ['wide pull-up'],
  },
  {
    name: 'Neutral-Grip Pulldown',
    region: 'back',
    equipment: 'cable',
    aliases: ['neutral pulldown'],
  },
  {
    name: 'Single-Arm Dumbbell Row',
    region: 'back',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['one arm row'],
  },
  {
    name: 'Meadows Row',
    region: 'back',
    equipment: 'barbell',
    unilateral: true,
  },
  {
    name: 'Seal Row',
    region: 'back',
    equipment: 'barbell',
  },
  {
    name: 'Machine Row',
    region: 'back',
    equipment: 'machine',
  },
  {
    name: 'Machine Pullover',
    region: 'back',
    equipment: 'machine',
  },
  {
    name: 'Good Morning',
    region: 'legs',
    equipment: 'barbell',
  },

  // -------------------------------------------------------- shoulders (more)
  {
    name: 'Push Press',
    region: 'shoulders',
    equipment: 'barbell',
  },
  {
    name: 'Seated Barbell Overhead Press',
    region: 'shoulders',
    equipment: 'barbell',
    aliases: ['seated ohp'],
  },
  {
    name: 'Landmine Press',
    region: 'shoulders',
    equipment: 'barbell',
    unilateral: true,
  },
  {
    name: 'Cable Rear Delt Fly',
    region: 'shoulders',
    equipment: 'cable',
  },
  {
    name: 'Leaning Cable Lateral Raise',
    region: 'shoulders',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Plate Front Raise',
    region: 'shoulders',
    equipment: 'other',
  },

  // ------------------------------------------------------------- arms (more)
  {
    name: 'EZ-Bar Curl',
    region: 'biceps',
    equipment: 'barbell',
    aliases: ['ez curl'],
  },
  {
    name: 'Spider Curl',
    region: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Cable Rope Hammer Curl',
    region: 'biceps',
    equipment: 'cable',
  },
  {
    name: 'Bayesian Cable Curl',
    region: 'biceps',
    equipment: 'cable',
    unilateral: true,
  },
  {
    name: 'Dumbbell Skull Crusher',
    region: 'triceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Rope Overhead Extension',
    region: 'triceps',
    equipment: 'cable',
    aliases: ['overhead rope extension'],
  },
  {
    name: 'Bench Dip',
    region: 'triceps',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.6,
  },
  {
    name: 'Reverse Curl',
    region: 'biceps',
    equipment: 'barbell',
  },
  {
    name: 'Behind-the-Back Wrist Curl',
    region: 'biceps',
    equipment: 'barbell',
  },

  // ------------------------------------------------------------- legs (more)
  {
    name: 'Pause Squat',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Box Squat',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Belt Squat',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Sissy Squat',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.7,
  },
  {
    name: 'Single-Leg Press',
    region: 'legs',
    equipment: 'machine',
    unilateral: true,
  },
  {
    name: 'Stiff-Leg Deadlift',
    region: 'legs',
    equipment: 'barbell',
    aliases: ['sldl'],
  },
  {
    name: 'Single-Leg Romanian Deadlift',
    region: 'legs',
    equipment: 'dumbbell',
    unilateral: true,
    aliases: ['single leg rdl'],
  },
  {
    name: 'Standing Leg Curl',
    region: 'legs',
    equipment: 'machine',
    unilateral: true,
  },
  {
    name: 'Cable Pull-Through',
    region: 'legs',
    equipment: 'cable',
  },
  {
    name: 'Curtsy Lunge',
    region: 'legs',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Leg Press Calf Raise',
    region: 'legs',
    equipment: 'machine',
  },
  {
    name: 'Donkey Calf Raise',
    region: 'legs',
    equipment: 'machine',
  },

  // ------------------------------------------------------------- core (more)
  {
    name: 'Toes-to-Bar',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.5,
  },
  {
    name: 'Weighted Plank',
    region: 'core',
    equipment: 'other',
    tracking: 'weight_time',
  },
  {
    name: 'Decline Sit-up',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.5,
  },
  {
    name: 'Bicycle Crunch',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Hanging Knee Raise',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.4,
  },
  {
    name: 'Landmine Rotation',
    region: 'core',
    equipment: 'barbell',
  },
  {
    name: 'Copenhagen Plank',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'time',
  },

  // --------------------------------------------------------- cardio (more)
  {
    name: 'Sled Push',
    region: 'cardio',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Battle Ropes',
    region: 'cardio',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Box Jump',
    region: 'cardio',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Burpee',
    region: 'cardio',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },

  // ---------------------------------------------------- olympic / power
  {
    name: 'Power Clean',
    region: 'legs',
    equipment: 'barbell',
    aliases: ['clean'],
  },
  {
    name: 'Hang Clean',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Clean and Jerk',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Snatch',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Power Snatch',
    region: 'back',
    equipment: 'barbell',
  },
  {
    name: 'Clean Pull',
    region: 'back',
    equipment: 'barbell',
  },
  {
    name: 'Thruster',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Wall Ball',
    region: 'legs',
    equipment: 'other',
    tracking: 'reps_only',
  },

  // ---------------------------------------------------- strongman
  {
    name: 'Atlas Stone Lift',
    region: 'back',
    equipment: 'other',
  },
  {
    name: 'Yoke Carry',
    region: 'back',
    equipment: 'other',
    tracking: 'weight_time',
  },
  {
    name: 'Log Press',
    region: 'shoulders',
    equipment: 'other',
  },
  {
    name: 'Sandbag Carry',
    region: 'core',
    equipment: 'other',
    tracking: 'weight_time',
  },
  {
    name: 'Suitcase Carry',
    region: 'core',
    equipment: 'dumbbell',
    tracking: 'weight_time',
    unilateral: true,
  },
  {
    name: 'Tire Flip',
    region: 'legs',
    equipment: 'other',
    tracking: 'reps_only',
  },

  // ---------------------------------------------------- chest (more)
  {
    name: 'Guillotine Press',
    region: 'chest',
    equipment: 'barbell',
  },
  {
    name: 'Floor Press',
    region: 'chest',
    equipment: 'barbell',
  },
  {
    name: 'Deficit Push-up',
    region: 'chest',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.7,
  },

  // ---------------------------------------------------- back (more)
  {
    name: 'Pendlay Deficit Row',
    region: 'back',
    equipment: 'barbell',
  },
  {
    name: 'Kroc Row',
    region: 'back',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'Gorilla Row',
    region: 'back',
    equipment: 'kettlebell',
    unilateral: true,
  },
  {
    name: 'Rope Face Pull',
    region: 'shoulders',
    equipment: 'cable',
  },
  {
    name: 'Kneeling Lat Pulldown',
    region: 'back',
    equipment: 'cable',
  },
  {
    name: 'Deadlift (Snatch Grip)',
    region: 'back',
    equipment: 'barbell',
  },

  // ---------------------------------------------------- shoulders (more)
  {
    name: 'Z Press',
    region: 'shoulders',
    equipment: 'barbell',
  },
  {
    name: 'Viking Press',
    region: 'shoulders',
    equipment: 'machine',
  },
  {
    name: 'Cable Upright Row',
    region: 'shoulders',
    equipment: 'cable',
  },
  {
    name: 'Machine Reverse Fly',
    region: 'shoulders',
    equipment: 'machine',
  },
  {
    name: 'Lu Raise',
    region: 'shoulders',
    equipment: 'dumbbell',
  },

  // ---------------------------------------------------- arms (more)
  {
    name: 'Zottman Curl',
    region: 'biceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Drag Curl',
    region: 'biceps',
    equipment: 'barbell',
  },
  {
    name: 'Cross-Body Hammer Curl',
    region: 'biceps',
    equipment: 'dumbbell',
    unilateral: true,
  },
  {
    name: 'JM Press',
    region: 'triceps',
    equipment: 'barbell',
  },
  {
    name: 'Tate Press',
    region: 'triceps',
    equipment: 'dumbbell',
  },
  {
    name: 'Diamond Push-up',
    region: 'triceps',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.64,
  },
  {
    name: 'Wrist Roller',
    region: 'biceps',
    equipment: 'other',
    tracking: 'weight_time',
  },

  // ---------------------------------------------------- legs (more)
  {
    name: 'Zercher Squat',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Landmine Squat',
    region: 'legs',
    equipment: 'barbell',
  },
  {
    name: 'Pistol Squat',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.9,
    unilateral: true,
  },
  {
    name: 'Cossack Squat',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.8,
    unilateral: true,
  },
  {
    name: 'Frog Pump',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'reps_only',
  },
  {
    name: 'Kettlebell Goblet Squat',
    region: 'legs',
    equipment: 'kettlebell',
    // Same equipment as 'Goblet Squat'; keep separate so the movement doesn't
    // offer two identical kettlebell options.
    movement: 'Kettlebell Goblet Squat',
  },
  {
    name: 'ATG Split Squat',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.85,
    unilateral: true,
  },
  {
    name: 'Tibialis Raise',
    region: 'legs',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.3,
  },

  // ---------------------------------------------------- core (more)
  {
    name: 'Dragon Flag',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'bodyweight_reps',
    bodyweightFactor: 0.6,
  },
  {
    name: 'Hollow Body Hold',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'Cable Pallof Hold',
    region: 'core',
    equipment: 'cable',
    tracking: 'weight_time',
  },
  {
    name: 'Weighted Decline Sit-up',
    region: 'core',
    equipment: 'other',
  },
  {
    name: 'L-Sit',
    region: 'core',
    equipment: 'bodyweight',
    tracking: 'time',
  },

  // ---------------------------------------------------- cardio (more)
  {
    name: 'Mountain Climbers',
    region: 'cardio',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'High Knees',
    region: 'cardio',
    equipment: 'bodyweight',
    tracking: 'time',
  },
  {
    name: 'Ski Erg',
    region: 'cardio',
    equipment: 'machine',
    tracking: 'distance_time',
  },
  {
    name: 'Sled Drag',
    region: 'cardio',
    equipment: 'other',
    tracking: 'time',
  },
  {
    name: 'Shadow Boxing',
    region: 'cardio',
    equipment: 'bodyweight',
    tracking: 'time',
  },
]
