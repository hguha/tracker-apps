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

// Picks the set-input UI: one component switches on this value. Bodyweight
// movements are a single type (`bodyweight_reps`); whether weight is added,
// assisted off, or none is the per-instance `loadMode`, not a separate type.
export const TRACKING_TYPES = [
  'weight_reps',
  'bodyweight_reps',
  'reps_only',
  'time',
  'distance_time',
  'weight_time',
] as const
export type TrackingType = (typeof TRACKING_TYPES)[number]

// How a bodyweight movement is loaded, chosen when it's added to a workout the
// same way equipment is (§4.3). Drives the set-input columns and volume sign:
// weighted adds the entered weight, assisted subtracts it, bodyweight uses neither.
export const LOAD_MODES = ['bodyweight', 'weighted', 'assisted'] as const
export type LoadMode = (typeof LOAD_MODES)[number]

export const LOAD_MODE_LABELS: Record<LoadMode, string> = {
  bodyweight: 'Bodyweight',
  weighted: 'Weighted',
  assisted: 'Assisted',
}

// Bodyweight movements pick a load mode instead of equipment; every other type
// either chooses equipment (weight_reps/weight_time) or has a fixed implement.
export function loadModeIsChosen(trackingType: TrackingType): boolean {
  return trackingType === 'bodyweight_reps'
}

// Equipment only varies for externally-loaded lifts (a bench can be barbell or
// dumbbell). Bodyweight, assisted, and cardio movements have a fixed implement, so
// the picker skips the equipment step and stamps `defaultEquipmentForTracking`.
export function equipmentIsChosen(trackingType: TrackingType): boolean {
  return trackingType === 'weight_reps' || trackingType === 'weight_time'
}

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

// The implement a non-chosen (bodyweight/assisted/cardio) movement is logged
// under, so records still scope consistently per (exercise + equipment).
export function defaultEquipmentForTracking(trackingType: TrackingType): Equipment {
  switch (trackingType) {
    case 'bodyweight_reps':
    case 'reps_only':
      return 'bodyweight'
    case 'time':
    case 'distance_time':
      return 'other'
    case 'weight_reps':
    case 'weight_time':
      return 'barbell'
  }
}

// The load mode a freshly-added bodyweight movement starts in; bodyweight is the
// common case and needs no weight field. null for every non-bodyweight type.
export function defaultLoadModeForTracking(trackingType: TrackingType): LoadMode | null {
  return trackingType === 'bodyweight_reps' ? 'bodyweight' : null
}

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
  // Coach-tailoring demographics; all null until provided (the coach tolerates absence).
  // birthYear (not a full date) → age, avoiding extra PII/timezone edge cases.
  sex: 'male' | 'female' | null
  birthYear: number | null
  experienceLevel: 'beginner' | 'intermediate' | 'advanced' | null
  trainingDaysPerWeek: number | null
  // Null until first-run setup completes. On the profile so it follows the
  // account across devices rather than re-running per device (§11.1.3).
  onboardedAt: number | null
  // The onboarding revision this account last completed. When it trails
  // ONBOARDING_VERSION the walkthrough runs again, so a reworked onboarding can be
  // re-shown to everyone with a single bump. 0 = never done the current flow.
  onboardingVersion: number

  theme: string
  colorScheme: 'system' | 'light' | 'dark'
  accentOverride: string | null
  soundEnabled: boolean
  autoStartRest: boolean
  showAvatar: boolean
}

// A movement ("Bench Press"), independent of equipment. Equipment is chosen when
// the exercise is added to a workout and lives on the WorkoutExercise — any
// movement can be loaded with any equipment, so the exercise stores none.
export interface Exercise extends SyncColumns {
  id: string
  // null = system library row.
  userId: string | null
  name: string
  // The body region trained, stored directly. There is deliberately no finer
  // muscle below it: every consumer (charts, coach, avatar, session titles)
  // aggregates by region, so a second taxonomy was upkeep with no reader.
  region: Region
  aliases: string[]
  movementPattern: MovementPattern
  trackingType: TrackingType
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
  // The equipment chosen for this instance of the base exercise. Drives the log
  // UI, volume math, and per-equipment records.
  equipment: Equipment
  // For bodyweight movements only: bodyweight / weighted / assisted, chosen the
  // way equipment is. null for every other tracking type.
  loadMode: LoadMode | null
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
  equipment: Equipment
  // See WorkoutExercise.loadMode.
  loadMode: LoadMode | null
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
  // Composite: `${exerciseId}:${equipment}:${recordType}` — records are scoped per
  // (base exercise + equipment), so a barbell and dumbbell bench are separate PRs.
  id: string
  userId: string
  exerciseId: string
  equipment: Equipment
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

// Denormalized cache of recent performance per (exercise + equipment) (§6.3), so
// the last-time header is one indexed lookup rather than a history scan. Scoped
// by equipment so a dumbbell day never prefills barbell numbers.
export interface LastPerformance {
  // Composite: `${exerciseId}:${equipment}`.
  id: string
  exerciseId: string
  equipment: Equipment
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
