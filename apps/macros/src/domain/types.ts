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

/**
 * A food the user entered themselves, from a label the databases don't have.
 *
 * A separate table from `foods` rather than a row in it, for one reason: `foods` is shared
 * reference data that survives an account switch, and this is the user's own data that must not.
 */
export interface CustomFood extends Food {
  userId: string
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

/**
 * Where a meal was eaten.
 *
 * Three values rather than in/out, because takeaway behaves like neither: portions and oil are a
 * restaurant's, but the setting is home, and someone whose pattern is "cooks all week, orders in on
 * Friday" learns nothing from a chart that files that under "out".
 *
 * `null` means nobody said, and is never treated as `home` — an unrecorded venue is not a fact.
 */
export type Venue = 'home' | 'restaurant' | 'takeaway'

export const VENUES = ['home', 'restaurant', 'takeaway'] as const

/** One food, recipe, or quick-add eaten at a time. The app's central row. */
export interface LogEntry extends SyncColumns {
  id: string
  userId: string
  /** Local calendar day, `yyyy-MM-dd`; denormalized so a day query is one index hit. */
  day: string
  eatenAt: number
  meal: MealSlot
  sortIndex: number

  /** Exactly one of these three is set — the *subject* of the row. */
  foodId: string | null
  recipeId: string | null
  quickAdd: Nutrients | null

  /**
   * The recipe this row came out of, when it was logged as ingredients.
   *
   * Provenance, not subject — which is why it can't reuse `recipeId`: the subject of the row is a
   * food, and the database constrains exactly one subject. Without it, logging a recipe as its
   * ingredients silently detached those rows from the recipe, so "what you cook" stopped counting
   * them and `recipeUsage` forgot the dish had ever been made.
   */
  fromRecipeId: string | null

  /**
   * The dish these rows were entered as, and what the user called it.
   *
   * "3 steak tacos" is six foods, and all six are needed for the numbers to be right — but the diary
   * then holds no line anybody recognises, and nothing to tap to have another one. Rows written
   * together share a `dishId`, so the day collapses to one line that still opens onto its parts.
   *
   * `dishName` is copied onto every row rather than looked up, for the same reason `nutrients` is:
   * it's what the user said at the time, and re-deriving it would let a later rename rewrite what
   * they ate. Both null on a single food logged on its own — most rows.
   */
  dishId: string | null
  dishName: string | null

  /** Grams is canonical; the portion is what the user picked, kept for display. */
  grams: number
  portionId: string | null
  portionCount: number | null

  /** Resolved at write time, so a reference-data update can't rewrite history. */
  nutrients: Nutrients
  source: EntrySource
  estimate: EstimateMeta | null
  /** Where it was eaten. Null on every row logged before the field existed. */
  venue: Venue | null
  note: string
}

export interface RecipeIngredient {
  id: string
  foodId: string | null
  /** Free text when unmatched, so a missing food never blocks a recipe. */
  label: string
  grams: number
  optional: boolean
  /**
   * The amount the recipe stated, verbatim-ish: "1 cup", "2 tbsp", "9 noodles".
   *
   * Grams are canonical and always will be — they're what the nutrients are computed from — but they
   * are not what a cook measures. A recipe that said "½ cup flour" came out as "63 g of flour", which
   * is the same fact in a form nobody can follow at a worktop, and it was *thrown away* on import
   * rather than being unavailable. Null on anything entered by hand in grams, and on every row saved
   * before the field existed; `lib/householdAmount` reconstructs a volume for those where it can.
   */
  amount: string | null
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
  /** A `CUISINES` key, or null when it isn't a cuisine anyone would name. */
  cuisine: CuisineKey | null
  /** Hands-on plus cooking, in minutes, when the source stated it. */
  totalMinutes: number | null
  sourceUrl: string | null
  authoredBy: 'user' | 'ai'
  /** Total for the whole recipe; per-serving is derived. */
  nutrients: Nutrients
}

/**
 * A closed list, so a filter has something to filter on.
 *
 * Free text would let "Asian", "asian food" and "Pan-Asian" all exist side by side and make the
 * filter useless — which is the whole reason it's here. Imports map onto it (see lib/cuisine);
 * anything that doesn't map keeps its own words in `tags` and files as null rather than being
 * forced into a bucket it doesn't belong in.
 */
export const CUISINES = [
  'american',
  'italian',
  'mexican',
  'chinese',
  'japanese',
  'korean',
  'thai',
  'vietnamese',
  'indian',
  'middle-eastern',
  'mediterranean',
  'french',
  'british',
  'caribbean',
  'african',
] as const

export type CuisineKey = (typeof CUISINES)[number]

/** How often a recipe has actually been cooked, derived from the log. */
export interface RecipeUsage {
  timesCooked: number
  /** `yyyy-MM-dd` of the most recent serving, or null if it has never been logged. */
  lastCookedDay: string | null
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
  /**
   * The weight this program is aiming at, in kg. Null when there isn't one.
   *
   * The rate alone is the right input for a calorie target and a useless thing to aim at: nothing
   * ever satisfies "lose 0.5% a week", so there was no point at which anything was achieved. This
   * is what gives the goal an end — and an ETA, computed from the measured trend rather than the
   * intended rate (see lib/goal.ts).
   */
  targetKg: number | null
  /** The weight trend when the target was set, so progress has a denominator. */
  startKg: number | null
  /** When the target was met, so it can be celebrated once and then moved on from. */
  reachedAt: number | null
}

export interface MacroTargets {
  kcal: number
  proteinMg: number
  carbsMg: number
  fatMg: number
}

/**
 * Targets the user typed in, and the day they start applying from.
 *
 * The app's premise is that a calorie target is *measured* rather than chosen, and that premise is
 * right — but it left no way to say "I want 2,400 and 180 g of protein", which people have perfectly
 * good reasons for: a coach's plan, a training block, a number that has worked before. Refusing the
 * question doesn't make the answer come from the weight trend; it makes the app the wrong tool.
 *
 * Dated, and only applying forward, for the same reason a check-in is: yesterday's 2,300 kcal was not
 * over a target that only exists now, and scoring the past against a number set today is what makes
 * changing a goal look like it rewrites history. Clearing it returns to the measured target.
 */
export interface ManualTargets extends MacroTargets {
  /** `yyyy-MM-dd`. Days before this keep whatever was in force then. */
  fromDay: string
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

/**
 * A day's water, as one running total.
 *
 * Not a log entry: water has no food, no macros and no portion, so every aggregate over the diary
 * would need to learn to skip it. Millilitres regardless of what the user is shown, because the
 * display unit is a preference and storing a preference in the data is how two devices come to
 * disagree.
 */
export interface WaterRow extends SyncColumns {
  id: string
  userId: string
  day: string
  ml: number
}

/**
 * The amounts the water card offers, per unit system.
 *
 * More than one, because a single "+ glass" button means logging a litre bottle is four taps and a
 * 32 oz flask is four taps of a number that was never 8 oz. The values are round in their *own*
 * system rather than converted from the other, so neither reads as an approximation of the other: a
 * US pint is 473 ml and calling it 500 would be wrong by a twentieth every time.
 */
export const WATER_STEPS = {
  metric: [
    { ml: 250, label: 'Glass' },
    { ml: 500, label: 'Bottle' },
    { ml: 1000, label: '1 L' },
  ],
  imperial: [
    { ml: 237, label: '8 oz' },
    { ml: 473, label: '16 oz' },
    { ml: 946, label: '32 oz' },
  ],
} as const satisfies Record<UnitSystem, readonly { ml: number; label: string }[]>

/**
 * Physical activity, as the five buckets people can actually place themselves in.
 *
 * Deliberately about the *week*, not about training alone: someone who lifts four times a week and
 * sits down for the other 160 hours burns less than a roofer who never trains, and a "sessions per
 * week" question can't tell them apart. Each bucket carries a physical-activity level (PAL)
 * multiplier on BMR — the standard model, and the one whose numbers are defensible.
 */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete'

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'athlete'] as const

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
 * Bump to re-run setup for everyone. Compared against the profile's `onboardingVersion`, which
 * syncs — so a reworked flow reaches every device once, and a second device never re-runs a version
 * the account already finished.
 *
 * It lives in `domain` rather than beside the screen because two other places have to agree with it:
 * the shell that decides whether to show setup, and the demo loader that writes a profile as though
 * setup were done. The demo used to hardcode `1`, so loading it dropped you back into onboarding —
 * where finishing it then overwrote the profile the demo had just written.
 */
export const ONBOARDING_VERSION = 3

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
  /**
   * Foods the user pinned, newest first.
   *
   * "Frequent" is derived from the log and can't be curated — it takes a fortnight to admit a new
   * staple and never forgets an old one. A star is the answer to "where do I save just this food":
   * on the profile rather than in its own table because it's a short list of ids, and it has to
   * follow the account onto a second device the same way appearance does.
   */
  favouriteFoodIds: string[]
  /**
   * How active the user is, for the cold-start estimate only.
   *
   * Null until asked, which is honest: the app's whole premise is that expenditure is *measured*
   * from intake against weight trend, and from the second check-in onward this field changes
   * nothing. But for the first fortnight there is nothing to measure, and the formula was assuming
   * three training sessions a week for everybody — so a desk-bound week one and a manual labourer's
   * week one got the same target, wrong in opposite directions by about 500 kcal.
   */
  activity: ActivityLevel | null
  /** Millilitres a day. Null until the user sets one; the card still counts without a target. */
  waterTargetMl: number | null
  /** Targets set by hand, which win over the measured ones from their day onward. Null is the default. */
  manualTargets: ManualTargets | null
  /** When to be nudged about logging. Null means never, which is the default. */
  reminders: RemindersConfig | null
}

/**
 * When to nudge, and only when there is something to nudge about.
 *
 * Every reminder is **conditional on the meal still being unlogged when it fires**, checked at fire
 * time rather than at schedule time. A tracker that says "you haven't logged lunch" to somebody who
 * logged it two hours ago is a tracker whose notifications get switched off — and with them the ones
 * that would have worked. That check is the whole feature; the times are just times.
 */
export interface RemindersConfig {
  /** Minutes from local midnight, per meal. Any slot may be present, including `snack`. */
  meals: { meal: MealSlot; minute: number; enabled: boolean }[]
  /** A single evening nudge, only if the day is completely empty. */
  endOfDay: { minute: number; enabled: boolean }
  /**
   * A nudge to step on the scales, only if there's no weigh-in today.
   *
   * Here rather than in its own setting because it obeys the same rule as the rest: conditional on
   * the thing still being undone when it fires. A weigh-in is also the one input the app cannot
   * derive from anything else — without it there is no trend, and without a trend there is no
   * measured expenditure — so it is the reminder with the most to lose by being missed.
   */
  weighIn: { minute: number; enabled: boolean }
}

export const DEFAULT_REMINDERS: RemindersConfig = {
  meals: [
    { meal: 'breakfast', minute: 9 * 60 + 30, enabled: true },
    { meal: 'lunch', minute: 13 * 60 + 30, enabled: true },
    { meal: 'dinner', minute: 20 * 60, enabled: true },
    // Off by default: a snack is the one meal plenty of people deliberately don't have.
    { meal: 'snack', minute: 16 * 60, enabled: false },
  ],
  endOfDay: { minute: 21 * 60 + 30, enabled: true },
  weighIn: { minute: 7 * 60 + 30, enabled: false },
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

export interface NutritionStats {
  daysLogged: number
  currentDayStreak: number
  bestDayStreak: number
  entriesLogged: number
  distinctFoods: number
  weighInDays: number
  bestWeighInStreak: number
  daysProteinMet: number
  daysWithinTarget: number
  daysFiberMet: number
  checkInsEarned: number
  savedMeals: number
  barcodesScanned: number
  describedMeals: number
  completeWeeks: number
}
