/**
 * Domain types. These mirror the Postgres schema in the spec (§4) one-to-one,
 * so the same shapes travel from IndexedDB to Postgres unchanged when sync lands.
 *
 * Storage is ALWAYS metric (§4.12). Anything named `_kg`, `_m`, or `_cm` is
 * canonical; conversion to the user's units happens only at the display
 * boundary, in `lib/units.ts`.
 */

/**
 * The fixed training regions, each mapped to a palette slot (§10.2).
 *
 * Biceps and triceps are separate regions rather than one "Arms": pull work and
 * push work load them on different days, so folding them together hid the
 * imbalance the split is meant to surface. Elbow flexors (biceps, brachialis)
 * and forearms roll up to `biceps`; the triceps stand alone.
 */
export const REGIONS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'legs',
  'core',
  'cardio',
] as const
export type Region = (typeof REGIONS)[number]

export const REGION_LABELS: Record<Region, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Legs',
  core: 'Core',
  cardio: 'Cardio',
}

/**
 * Drives the entire set-input UI (§6.5). One component switches on this value,
 * so adding a modality is a new case rather than a new screen.
 */
export const TRACKING_TYPES = [
  'weight_reps', // barbell bench press
  'bodyweight_reps', // push-up
  'weighted_bodyweight', // weighted pull-up
  'assisted_bodyweight', // assisted dip
  'reps_only', // band pull-apart
  'time', // plank
  'distance_time', // treadmill run
  'weight_time', // farmer's carry
] as const
export type TrackingType = (typeof TRACKING_TYPES)[number]

export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'smith',
  'bodyweight',
  'kettlebell',
  'band',
  'other',
] as const
export type Equipment = (typeof EQUIPMENT)[number]

export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'rotation',
  'isolation',
  'cardio',
] as const
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number]

/**
 * Set type. Collapsed to a single `normal` value — the warmup/dropset/AMRAP/etc.
 * distinctions were removed as confusing and unused. The column is kept (rather
 * than dropped) so stored rows and the sync schema stay stable, and so the
 * feature could return without a migration.
 */
export const SET_TYPES = ['normal'] as const
export type SetType = (typeof SET_TYPES)[number]

export type WeightUnit = 'lb' | 'kg'
export type DistanceUnit = 'mi' | 'km'
export type LengthUnit = 'in' | 'cm'

/**
 * Sync bookkeeping present on every user-owned row (§4.11). Carried in the
 * prototype even though nothing syncs yet — retrofitting these columns after
 * history exists means a migration over real data.
 */
export interface SyncColumns {
  createdAt: number
  updatedAt: number
  /** Soft delete. Every read path filters this out; hard deletes can't sync. */
  deletedAt: number | null
  /** Bumped locally per edit. Drives last-write-wins comparison. */
  clientRev: number
}

export interface Profile extends SyncColumns {
  id: string
  displayName: string
  unitWeight: WeightUnit
  unitDistance: DistanceUnit
  unitLength: LengthUnit
  /** IANA zone. Required for correct day/week bucketing. */
  timezone: string
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1
  /** Target sessions per week, for the Home progress ring (§5.2.1). */
  weeklyWorkoutGoal: number
  defaultRestSeconds: number
  /** RPE inputs are hidden by default (§6.4). The columns still exist. */
  showRpe: boolean
  /** Denormalized latest bodyweight, for bodyweight-exercise volume math. */
  bodyweightCacheKg: number | null
  /** Height in cm, or null if unset. Storage is metric (§4.12); the Me screen
   *  converts to the user's length unit. Fed to the coach for tailoring. */
  heightCm: number | null
  /** Free-text training goal ("gain strength", "lean out for summer"). Drives
   *  the coach when no per-request goal is given, and is sent in the coach
   *  summary (shown in the §13 "data sent" disclosure). Empty = unset. */
  trainingGoal: string
  /** When first-run setup was completed, or null if it hasn't been. On the
   *  profile rather than localStorage so it follows the account across devices —
   *  otherwise signing in on a second device re-runs setup (§11.1.3). */
  onboardedAt: number | null

  // Appearance and feedback (§10.8, §6.8).
  /** Named preset — `default`, `slate`, `forest`, `ocean`, `sunset`, … */
  theme: string
  /** Independent of the preset, so a theme keeps its light and dark variants. */
  colorScheme: 'system' | 'light' | 'dark'
  /** Overrides the preset's accent only, never chart series colors. */
  accentOverride: string | null
  soundEnabled: boolean
  /**
   * When true, logging a set starts the rest timer. Off by default — an implicit
   * timer was unpredictable, so §6.4.2 makes the rest button the only reliable
   * trigger and this the opt-in shortcut.
   */
  autoStartRest: boolean
  /** Show the training avatar on Home. Off by default — opt-in while it's a
   *  prototype (§5.2.1). */
  showAvatar: boolean
}

export interface Muscle extends SyncColumns {
  id: string
  /** null = system row, visible to everyone. */
  userId: string | null
  name: string
  region: Region
  isArchived: boolean
}

export interface Exercise extends SyncColumns {
  id: string
  /** null = system library row. */
  userId: string | null
  name: string
  primaryMuscleId: string
  /** Partial credit for secondaries, e.g. bench press → front delt at 0.5. */
  secondaryMuscles: { muscleId: string; contribution: number }[]
  aliases: string[]
  equipment: Equipment
  movementPattern: MovementPattern
  trackingType: TrackingType
  isUnilateral: boolean
  /** Fraction of bodyweight moved: pull-up 1.00, push-up 0.64, dip 0.95. */
  bodyweightFactor: number | null
  /** Retained for schema/sync stability; the key-lift feature was removed. */
  isKeyLift: boolean
  /** Cues, pin settings, seat height. */
  notes: string
  defaultRestSeconds: number | null
  /** Never hard-delete — history references this row. */
  isArchived: boolean
}

export interface Workout extends SyncColumns {
  id: string
  userId: string
  /** Timestamp, not a date — two-a-days must work (§4.4). */
  startedAt: number
  /** null = in progress. At most one such row per user. */
  endedAt: number | null
  title: string
  notes: string
  perceivedExertion: number | null
  /** Provenance, so planned-vs-actual adherence comes free. */
  templateId: string | null
  bodyweightKg: number | null
}

export interface WorkoutExercise extends SyncColumns {
  id: string
  workoutId: string
  exerciseId: string
  position: number
  /** Same value = same superset. Rest starts after the group's last exercise. */
  supersetGroup: number | null
  restSeconds: number | null
  notes: string
}

export interface WorkoutSet extends SyncColumns {
  id: string
  workoutExerciseId: string
  position: number
  setType: SetType
  weightKg: number | null
  reps: number | null
  /** Unilateral exercises only. */
  repsLeft: number | null
  repsRight: number | null
  durationSeconds: number | null
  distanceM: number | null
  rpe: number | null
  rir: number | null
  /** Measured, not target. Powers "rest taken vs target" (D-36). */
  restTakenSeconds: number | null
  /** false = planned but not performed. Templates instantiate as unchecked. */
  isCompleted: boolean
  completedAt: number | null
  notes: string
  /** Display hint so a lb user who typed 135 sees exactly 135 again (§4.12). */
  enteredUnit: WeightUnit | null
}

export interface Template extends SyncColumns {
  id: string
  userId: string
  name: string
  description: string
  /** One level of nesting, e.g. "PPL 6-day". */
  folder: string | null
  lastUsedAt: number | null
  timesUsed: number
  isArchived: boolean
}

export interface TemplateExercise extends SyncColumns {
  id: string
  templateId: string
  exerciseId: string
  position: number
  supersetGroup: number | null
  targetSets: number | null
  /** Ranges, because real programs read "3×8–10". All nullable. */
  targetRepsLow: number | null
  targetRepsHigh: number | null
  targetWeightKg: number | null
  targetRpe: number | null
  restSeconds: number | null
  notes: string
  /**
   * Declarative progression (§7 Phase 4). null = manual, no auto-progression.
   * When set, the target weight is nudged at instantiation based on how the last
   * session against this template-exercise went. The deterministic version of
   * programming automation — ships before any LLM.
   */
  progression: ProgressionRule | null
}

/**
 * A double-progression rule: hold the weight until every working set reaches the
 * top of the rep range (at or under an RPE cap), then add an increment and reset
 * to the bottom of the range. The most common linear-progression scheme.
 */
export interface ProgressionRule {
  kind: 'double'
  /** kg to add when the advance condition is met. */
  incrementKg: number
  /** Only advance if the hardest logged set was at or below this RPE. null = ignore RPE. */
  maxRpe: number | null
}

export const RECORD_TYPES = [
  'max_weight',
  'max_reps_any_weight',
  'max_est_1rm',
  'max_volume_session',
  'max_duration',
  'max_distance',
] as const
export type RecordType = (typeof RECORD_TYPES)[number]

export interface PersonalRecord extends SyncColumns {
  /** Composite: `${exerciseId}:${recordType}`. */
  id: string
  userId: string
  exerciseId: string
  recordType: RecordType
  value: number
  achievedAt: number
  setId: string
}

export type MetricUnitType =
  'mass' | 'length' | 'percent' | 'count' | 'duration' | 'ratio' | 'arbitrary'

export type MetricCategory =
  | 'body_composition'
  | 'circumference'
  | 'vitals'
  | 'performance'
  | 'subjective'
  | 'custom'

export interface MetricDefinition extends SyncColumns {
  id: string
  userId: string | null
  key: string
  label: string
  unitType: MetricUnitType
  category: MetricCategory
  /**
   * null means no delta color is applied — bodyweight rising is neither good
   * nor bad, and inventing a valence is worse than omitting one (§10.3).
   */
  higherIsBetter: boolean | null
  aggregation: 'last' | 'mean' | 'min' | 'max'
  precision: number
}

export interface MetricEntry extends SyncColumns {
  id: string
  userId: string
  definitionId: string
  measuredAt: number
  value: number
  notes: string
}

/**
 * Denormalized cache of recent performance per exercise (§6.3). One indexed
 * lookup instead of a scan over history, so the last-time header renders
 * instantly and offline.
 */
export interface LastPerformance {
  exerciseId: string
  sessions: PerformedSession[]
  updatedAt: number
}

export interface PerformedSession {
  workoutId: string
  performedAt: number
  sets: PerformedSet[]
  /** Best e1RM in the session, or null if no set was in the 1-12 rep window. */
  bestE1rmKg: number | null
  volumeKg: number
}

export interface PerformedSet {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
  /** Carried so progression rules can gate on RPE (§7 Phase 4). Optional — RPE
   *  logging is off by default, and older cached rows won't have it. */
  rpe?: number | null
}
