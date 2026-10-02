import {
  countBadge,
  evaluateBadges as evaluate,
  groupBadges,
  ratio,
  type Badge as EngineBadge,
  type BadgeState as EngineBadgeState,
} from '@tracker-engine/badges'

/**
 * What MACROcosm rewards, and deliberately what it doesn't.
 *
 * Nothing here is a badge for eating less. Rewarding a deficit teaches people to under-eat for a
 * streak, which is the failure mode a nutrition app has an actual duty to avoid — so the targets
 * are for *logging honestly and hitting the plan*: days recorded, protein met, weight measured,
 * the diet varied. Losing weight faster earns nothing.
 */

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
  /** Weeks with at least four days logged — the bar an expenditure estimate needs. */
  completeWeeks: number
}

export type BadgeGroup = 'Consistency' | 'Logging' | 'Nutrition' | 'Measurement' | 'Craft'

export type Badge = EngineBadge<NutritionStats, BadgeGroup>
export type BadgeState = EngineBadgeState<NutritionStats, BadgeGroup>

type Pick_ = (stats: NutritionStats) => number

const count = (
  key: string,
  label: string,
  caption: string,
  icon: string,
  group: BadgeGroup,
  pick: Pick_,
  target: number,
  unit = '',
): Badge => countBadge<NutritionStats, BadgeGroup>(key, label, caption, icon, group, pick, target, unit)

/** A share of the days logged, so it stays fair whether someone has 20 days or 400. */
function rateBadge(
  key: string,
  label: string,
  caption: string,
  icon: string,
  group: BadgeGroup,
  pick: Pick_,
  fraction: number,
  minimumDays: number,
): Badge {
  return {
    key,
    label,
    caption,
    icon,
    group,
    progress: (stats) =>
      stats.daysLogged < minimumDays
        ? ratio(stats.daysLogged, minimumDays) * 0.99
        : ratio(pick(stats) / stats.daysLogged, fraction),
    detail: (stats) =>
      stats.daysLogged < minimumDays
        ? `${stats.daysLogged} / ${minimumDays} days logged first`
        : `${Math.round((pick(stats) / stats.daysLogged) * 100)}% / ${Math.round(fraction * 100)}% of days`,
  }
}

export const BADGES: Badge[] = [
  // ── Consistency: the habit the whole method rests on ──
  count('first-day', 'Day One', 'Log everything you eat for a day.', '🌱', 'Consistency', (s) => s.daysLogged, 1),
  count('week-logged', 'First Week', 'Log 7 days.', '📅', 'Consistency', (s) => s.daysLogged, 7),
  count('month-logged', 'Full Month', 'Log 30 days.', '🗓️', 'Consistency', (s) => s.daysLogged, 30),
  count('hundred-days', 'Hundred Days', 'Log 100 days.', '💯', 'Consistency', (s) => s.daysLogged, 100),
  count('year-logged', 'Year of Meals', 'Log 365 days.', '🎆', 'Consistency', (s) => s.daysLogged, 365),

  count('streak-3', 'Three Straight', 'Log 3 days in a row.', '3️⃣', 'Consistency', (s) => s.bestDayStreak, 3, ' days'),
  count('streak-7', 'Seven Straight', 'Log 7 days in a row.', '🔥', 'Consistency', (s) => s.bestDayStreak, 7, ' days'),
  count('streak-30', 'Unbroken Month', 'Log 30 days in a row.', '🌕', 'Consistency', (s) => s.bestDayStreak, 30, ' days'),
  count('streak-100', 'Hundred in a Row', 'Log 100 days in a row.', '💎', 'Consistency', (s) => s.bestDayStreak, 100, ' days'),

  count('complete-weeks-4', 'Four Good Weeks', 'Four weeks with at least 4 days logged — enough for the app to measure you.', '📊', 'Consistency', (s) => s.completeWeeks, 4, ' wks'),
  count('complete-weeks-12', 'A Season Tracked', 'Twelve weeks with at least 4 days logged.', '🧭', 'Consistency', (s) => s.completeWeeks, 12, ' wks'),

  // ── Measurement: the other half of the measurement, and the part people skip ──
  count('first-weigh-in', 'On the Scale', 'Record your first weigh-in.', '⚖️', 'Measurement', (s) => s.weighInDays, 1),
  count('weigh-ins-30', 'Thirty Weigh-ins', 'Record 30 weigh-ins.', '📉', 'Measurement', (s) => s.weighInDays, 30),
  count('weigh-ins-100', 'Hundred Weigh-ins', 'Record 100 weigh-ins.', '🧮', 'Measurement', (s) => s.weighInDays, 100),
  count('weigh-streak-7', 'Daily Weigher', 'Weigh in 7 days in a row — noise averages out, one reading never does.', '📈', 'Measurement', (s) => s.bestWeighInStreak, 7, ' days'),
  count('weigh-streak-30', 'Month on the Scale', 'Weigh in 30 days in a row.', '🛰️', 'Measurement', (s) => s.bestWeighInStreak, 30, ' days'),
  count('check-in-1', 'First Check-in', 'Earn a weekly check-in — your first measured expenditure.', '🔬', 'Measurement', (s) => s.checkInsEarned, 1),
  count('check-in-12', 'Twelve Check-ins', 'Earn 12 weekly check-ins.', '🧪', 'Measurement', (s) => s.checkInsEarned, 12),

  // ── Nutrition: hitting the plan, not beating it ──
  count('protein-day', 'Protein Met', 'Hit your protein target for a day.', '🥩', 'Nutrition', (s) => s.daysProteinMet, 1),
  count('protein-10', 'Protein Regular', 'Hit your protein target on 10 days.', '🍗', 'Nutrition', (s) => s.daysProteinMet, 10),
  count('protein-50', 'Protein Habit', 'Hit your protein target on 50 days.', '🥚', 'Nutrition', (s) => s.daysProteinMet, 50),
  rateBadge('protein-rate', 'Reliable Protein', 'Meet your protein target on 80% of your logged days.', '🎯', 'Nutrition', (s) => s.daysProteinMet, 0.8, 14),

  count('on-target-10', 'On Plan', 'Land within 10% of your calorie target on 10 days.', '🎚️', 'Nutrition', (s) => s.daysWithinTarget, 10),
  rateBadge('on-target-rate', 'Steady Hand', 'Land within 10% of your calorie target on 70% of logged days.', '⚓', 'Nutrition', (s) => s.daysWithinTarget, 0.7, 14),

  count('fiber-10', 'Fibre Friendly', 'Meet the fibre reference on 10 days.', '🌾', 'Nutrition', (s) => s.daysFiberMet, 10),
  rateBadge('fiber-rate', 'Gut Feeling', 'Meet the fibre reference on half your logged days.', '🥦', 'Nutrition', (s) => s.daysFiberMet, 0.5, 14),

  // ── Logging: breadth, and the fast paths ──
  count('entries-100', 'Hundred Items', 'Log 100 items.', '🧾', 'Logging', (s) => s.entriesLogged, 100),
  count('entries-1000', 'Thousand Items', 'Log 1,000 items.', '📚', 'Logging', (s) => s.entriesLogged, 1000),
  count('variety-25', 'Varied Plate', 'Log 25 different foods.', '🥗', 'Logging', (s) => s.distinctFoods, 25),
  count('variety-100', 'Wide Palate', 'Log 100 different foods.', '🍱', 'Logging', (s) => s.distinctFoods, 100),
  count('variety-250', 'Encyclopedic Eater', 'Log 250 different foods.', '🌍', 'Logging', (s) => s.distinctFoods, 250),

  // ── Craft: using the tools that make logging cheap enough to keep doing ──
  count('first-scan', 'Scanner', 'Log something by scanning its barcode.', '🔎', 'Craft', (s) => s.barcodesScanned, 1),
  count('scans-25', 'Barcode Regular', 'Log 25 items by barcode.', '🏷️', 'Craft', (s) => s.barcodesScanned, 25),
  count('first-describe', 'In Your Own Words', 'Log a meal by describing it.', '💬', 'Craft', (s) => s.describedMeals, 1),
  count('describe-25', 'Describer', 'Log 25 meals by describing them.', '🗣️', 'Craft', (s) => s.describedMeals, 25),
  count('first-saved-meal', 'Saved for Later', 'Save a meal you eat often.', '🔖', 'Craft', (s) => s.savedMeals, 1),
  count('saved-meals-5', 'Rotation', 'Save 5 meals.', '🗂️', 'Craft', (s) => s.savedMeals, 5),
]

const GROUP_ORDER: BadgeGroup[] = [
  'Consistency',
  'Measurement',
  'Nutrition',
  'Logging',
  'Craft',
]

export const evaluateBadges = (stats: NutritionStats): BadgeState[] => evaluate(BADGES, stats)
export const groupedBadges = (all: BadgeState[]) => groupBadges(all, GROUP_ORDER)
