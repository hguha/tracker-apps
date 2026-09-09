export interface SyncColumns {
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  clientRev: number
}

/**
 * Nutrients in integer milligrams, kcal as an integer.
 *
 * Floats in grams reintroduce exactly the drift REPutation fixed by storing kg canonically
 * and COINcidence by storing minor units: a day's total must equal the sum of its rows.
 * `null` means unknown and never zero — an unmeasured micronutrient is not an absence.
 */
export interface Nutrients {
  kcal: number
  proteinMg: number
  carbsMg: number
  fatMg: number
  fiberMg: number | null
  sugarMg: number | null
  satFatMg: number | null
  sodiumMg: number | null
  potassiumMg: number | null
  cholesterolMg: number | null
  calciumMg: number | null
  ironMg: number | null
}

export const NUTRIENT_KEYS = [
  'kcal',
  'proteinMg',
  'carbsMg',
  'fatMg',
  'fiberMg',
  'sugarMg',
  'satFatMg',
  'sodiumMg',
  'potassiumMg',
  'cholesterolMg',
  'calciumMg',
  'ironMg',
] as const satisfies readonly (keyof Nutrients)[]

/** Keys that are always present; the rest are nullable and propagate null through sums. */
export const CORE_NUTRIENT_KEYS = ['kcal', 'proteinMg', 'carbsMg', 'fatMg'] as const

export const EMPTY_NUTRIENTS: Nutrients = {
  kcal: 0,
  proteinMg: 0,
  carbsMg: 0,
  fatMg: 0,
  fiberMg: null,
  sugarMg: null,
  satFatMg: null,
  sodiumMg: null,
  potassiumMg: null,
  cholesterolMg: null,
  calciumMg: null,
  ironMg: null,
}

export type FoodSource = 'usda' | 'off' | 'custom'

export interface FoodPortion {
  id: string
  /** "medium (3\" dia)", "1 cup, chopped", "1 slice". */
  label: string
  grams: number
  isDefault: boolean
}

/** Reference data: server-authored and pull-only, never edited by a client. */
export interface Food extends SyncColumns {
  /** `usda:${fdcId}` | `off:${barcode}` | `custom:${uuid}`. */
  id: string
  source: FoodSource
  description: string
  brand: string | null
  barcode: string | null
  category: string | null
  dataType: string | null
  /** Per 100 g (or ml for liquids) — the canonical basis for all arithmetic. */
  per100: Nutrients
  /** For volume→mass when a portion is measured in ml. */
  gramsPerMl: number | null
  portions: FoodPortion[]
  verifiedAt: number | null
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export type EntrySource =
  | 'search'
  | 'barcode'
  /** Broken out of a description the user typed, then matched to real foods. */
  | 'describe'
  | 'photo'
  | 'recipe'
  | 'quick'
  | 'copy'
  /** Logged from a saved meal. */
  | 'template'

export interface EstimateMeta {
  confidence: 'high' | 'medium' | 'low'
  /** What the model said before matching, so a bad match is diagnosable. */
  rawLabel: string
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
}

/** One food, recipe, or quick-add eaten at a time. The app's central row. */
export interface LogEntry extends SyncColumns {
  id: string
  userId: string
  /** Local calendar day, `yyyy-MM-dd`; denormalized so a day query is one index hit. */
  day: string
  eatenAt: number
  meal: MealSlot
  sortIndex: number

  /** Exactly one of these three is set. */
  foodId: string | null
  recipeId: string | null
  quickAdd: Nutrients | null

  /** Grams is canonical; the portion is what the user picked, kept for display. */
  grams: number
  portionId: string | null
  portionCount: number | null

  /** Resolved at write time, so a reference-data update can't rewrite history. */
  nutrients: Nutrients
  source: EntrySource
  estimate: EstimateMeta | null
  note: string
}

export interface RecipeIngredient {
  id: string
  foodId: string | null
  /** Free text when unmatched, so a missing food never blocks a recipe. */
  label: string
  grams: number
  optional: boolean
}

export interface Recipe extends SyncColumns {
  id: string
  userId: string
  name: string
  servings: number
  /** Cooked yield, so a portion can be "150 g of the finished dish". */
  yieldGrams: number | null
  ingredients: RecipeIngredient[]
  steps: string[]
  tags: string[]
  sourceUrl: string | null
  authoredBy: 'user' | 'ai'
  /** Total for the whole recipe; per-serving is derived. */
  nutrients: Nutrients
}

export interface MealTemplateItem {
  id: string
  foodId: string | null
  recipeId: string | null
  grams: number
  nutrients: Nutrients
}

export interface MealTemplate extends SyncColumns {
  id: string
  userId: string
  name: string
  items: MealTemplateItem[]
  nutrients: Nutrients
}

export type Goal = 'lose' | 'gain' | 'maintain'
export type CoachingMode = 'coached' | 'collaborative' | 'manual'

/** Per-weekday multipliers for calorie cycling, Sunday first. Must average 1. */
export interface CyclingConfig {
  multipliers: number[]
}

export interface Program extends SyncColumns {
  id: string
  userId: string
  goal: Goal
  /** Signed %/week of bodyweight. −0.5 = lose half a percent per week. */
  ratePctPerWeek: number
  startedAt: number
  endedAt: number | null
  coachingMode: CoachingMode
  /** Grams per kg bodyweight; the floor the macro split is built around. */
  proteinGPerKg: number
  fatMinPctKcal: number
  cycling: CyclingConfig | null
}

export interface MacroTargets {
  kcal: number
  proteinMg: number
  carbsMg: number
  fatMg: number
}

/** One weekly recalculation. Immutable audit trail — never updated in place. */
export interface CheckIn extends SyncColumns {
  id: string
  userId: string
  weekStart: string
  expenditureKcal: number
  /** Standard error; the UI must never show the estimate without it. */
  expenditureSe: number
  trendKg: number
  trendChangeKgPerWeek: number
  meanIntakeKcal: number
  daysLogged: number
  /** The energy density used for ΔE, stored so a later change can't rewrite history. */
  kcalPerKg: number
  targets: MacroTargets
  status: 'applied' | 'proposed' | 'declined'
  note: string
}

export interface BodyWeightRow extends SyncColumns {
  id: string
  userId: string
  day: string
  kg: number
  source: string
}

export type UnitSystem = 'metric' | 'imperial'
export type ThemePreset =
  | 'default'
  | 'slate'
  | 'forest'
  | 'ocean'
  | 'sunset'
  | 'crimson'
  | 'mono'
export type ColorSchemePreference = 'system' | 'light' | 'dark'

/**
 * Synced, one row per user, exactly like REPutation's. Appearance and units follow the account
 * so a second device looks right immediately; height/birthYear/sex do because the cold-start
 * estimate needs them anywhere; and `onboardingVersion` does so setup doesn't re-run per
 * device — which is the whole reason this isn't device-local.
 */
export interface Profile extends SyncColumns {
  id: string
  displayName: string
  units: UnitSystem
  theme: ThemePreset
  colorScheme: ColorSchemePreference
  accentOverride: string | null
  heightCm: number | null
  birthYear: number | null
  sex: 'male' | 'female' | null
  onboardedAt: number | null
  /** The onboarding revision this account last completed; below ONBOARDING_VERSION re-runs it. */
  onboardingVersion: number
  /**
   * Free text the coach reads: allergies, "vegetarian", "I hate mushrooms", "no dairy". The
   * single highest-value field for meal suggestions, and worthless if it doesn't sync — hence
   * on the profile rather than device-local.
   */
  dietNotes: string
  /** Null when the user eats whenever; set when they keep an eating window. */
  eatingWindow: EatingWindow | null
}

/**
 * An eating window, in minutes from local midnight.
 *
 * Fasting changes no arithmetic — a day's calories are its calories — so this deliberately
 * does not touch targets. What it changes is what the app is entitled to say: "you're behind
 * on protein" at 10am is wrong advice for someone whose window opens at noon, and a plain
 * remaining-calorie figure is the honest thing to show until it does.
 */
export interface EatingWindow {
  startMinute: number
  endMinute: number
}

/** Device-local, never synced: the REPutation grant token belongs to this device's keychain. */
export interface DeviceSettings {
  id: 'device'
  /** Opaque grant token for the REPutation link; null until connected. */
  reputationGrant: string | null
}
