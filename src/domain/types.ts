// Mirrors the Postgres schema (§4) one-to-one. Storage is always metric —
// anything `_kg`/`_m`/`_cm` is canonical; conversion happens only in lib/units.

// Biceps and triceps are separate regions, not one "Arms", so a push/pull
// imbalance is visible. Elbow flexors and forearms roll up to `biceps`.
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

// Picks the set-input UI: one component switches on this value.
export const TRACKING_TYPES = [
  'weight_reps',
  'bodyweight_reps',
  'weighted_bodyweight',
  'assisted_bodyweight',
  'reps_only',
  'time',
  'distance_time',
  'weight_time',
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

// Derived from the primary muscle's region (domain/movement.ts), not asked for.
// Only cardio (switches the log UI) and push/pull (session titles) are used.
export const MOVEMENT_PATTERNS = ['push', 'pull', 'other', 'cardio'] as const
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number]

// Collapsed to one value; the warmup/dropset/etc. distinctions were removed. Kept
// as a column so stored rows and the sync schema stay stable.
export const SET_TYPES = ['normal'] as const
export type SetType = (typeof SET_TYPES)[number]

export type WeightUnit = 'lb' | 'kg'
export type DistanceUnit = 'mi' | 'km'
export type LengthUnit = 'in' | 'cm'

export interface SyncColumns {
  createdAt: number
  updatedAt: number
  // Soft delete: every read filters this out. Hard deletes can't sync.
  deletedAt: number | null
  // Bumped per edit; drives last-write-wins.
  clientRev: number
}

export interface Profile extends SyncColumns {
  id: string
  displayName: string
  unitWeight: WeightUnit
  unitDistance: DistanceUnit
  unitLength: LengthUnit
  timezone: string
  weekStartsOn: 0 | 1
  weeklyWorkoutGoal: number
  defaultRestSeconds: number
  showRpe: boolean
  // Latest bodyweight, denormalized for bodyweight-exercise volume math.
  bodyweightCacheKg: number | null
  heightCm: number | null
  // Fed to the coach for tailoring; free text. Empty = unset.
  trainingGoal: string
  // Null until first-run setup completes. On the profile so it follows the
  // account across devices rather than re-running per device (§11.1.3).
  onboardedAt: number | null

  theme: string
  colorScheme: 'system' | 'light' | 'dark'
  accentOverride: string | null
  soundEnabled: boolean
  autoStartRest: boolean
  showAvatar: boolean
}

export interface Muscle extends SyncColumns {
  id: string
  // null = system row, visible to everyone.
  userId: string | null
  name: string
  region: Region
  isArchived: boolean
}

export interface Exercise extends SyncColumns {
  id: string
  // null = system library row.
  userId: string | null
  name: string
  primaryMuscleId: string
  aliases: string[]
  equipment: Equipment
  movementPattern: MovementPattern
  trackingType: TrackingType
  isUnilateral: boolean
  // Fraction of bodyweight moved: pull-up 1.00, push-up 0.64, dip 0.95.
  bodyweightFactor: number | null
  // Retained for schema/sync stability; the key-lift feature was removed.
  isKeyLift: boolean
  notes: string
  defaultRestSeconds: number | null
  // Never hard-delete — history references this row.
  isArchived: boolean
}

export interface Workout extends SyncColumns {
  id: string
  userId: string
  // Timestamp, not a date — two-a-days must work (§4.4).
  startedAt: number
  // null = in progress. At most one such row per user.
  endedAt: number | null
  title: string
  notes: string
  perceivedExertion: number | null
  templateId: string | null
  bodyweightKg: number | null
}

export interface WorkoutExercise extends SyncColumns {
  id: string
  workoutId: string
  exerciseId: string
  position: number
  // Same value = same superset.
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
  // Unilateral exercises only.
  repsLeft: number | null
  repsRight: number | null
  durationSeconds: number | null
  distanceM: number | null
  rpe: number | null
  rir: number | null
  restTakenSeconds: number | null
  // false = planned but not performed. Templates instantiate as unchecked.
  isCompleted: boolean
  completedAt: number | null
  notes: string
  // Display hint so a lb user who typed 135 sees exactly 135 again (§4.12).
  enteredUnit: WeightUnit | null
}

export interface Template extends SyncColumns {
  id: string
  userId: string
  name: string
  description: string
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
  targetRepsLow: number | null
  targetRepsHigh: number | null
  targetWeightKg: number | null
  targetRpe: number | null
  restSeconds: number | null
  notes: string
  // null = manual. When set, the target weight is nudged at instantiation from
  // the last session's result (§7 Phase 4).
  progression: ProgressionRule | null
}

// Double progression: hold the weight until every set hits the top of the rep
// range (under the RPE cap), then add the increment and reset to the bottom.
export interface ProgressionRule {
  kind: 'double'
  incrementKg: number
  // null = ignore RPE.
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
  // Composite: `${exerciseId}:${recordType}`.
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
  // null = no delta color; bodyweight rising is neither good nor bad (§10.3).
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

// Denormalized cache of recent performance per exercise (§6.3), so the last-time
// header is one indexed lookup rather than a history scan.
export interface LastPerformance {
  exerciseId: string
  sessions: PerformedSession[]
  updatedAt: number
}

export interface PerformedSession {
  workoutId: string
  performedAt: number
  sets: PerformedSet[]
  // null if no set was in the 1-12 rep window.
  bestE1rmKg: number | null
  volumeKg: number
}

export interface PerformedSet {
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceM: number | null
  // Optional: RPE logging is off by default and older cached rows lack it.
  rpe?: number | null
}
