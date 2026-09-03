// The Home badge catalog (§5.2.1): config-driven — adding a badge is one entry here.
// `progress` returns 0–1 (≥ 1 is earned); `detail` renders the concrete state.

import { distanceToM, formatDisplayWeight, weightToKg } from '@/lib/units'

export interface LifetimeStats {
  totalWorkouts: number
  totalSets: number
  totalVolumeKg: number
  bestWeekStreak: number
  currentWeekStreak: number
  /** Best estimated 1RM in kg on each of the big three, 0 if never trained. */
  bestSquatE1rmKg: number
  bestBenchE1rmKg: number
  bestDeadliftE1rmKg: number
  bestAnyE1rmKg: number
  bestOverheadPressE1rmKg: number
  bestRowE1rmKg: number
  bestPullUpE1rmKg: number
  bestDipE1rmKg: number
  totalCardioMeters: number
  totalCardioSeconds: number
  distinctExercises: number
  distinctRegions: number
  totalReps: number
  totalBodyweightReps: number
  maxRepsInSet: number
  maxSetWeightKg: number
  totalDaysTrained: number
  bestDayStreak: number
  earlyWorkouts: number
  lateWorkouts: number
  weekendWorkouts: number
  prCount: number
  totalTrainingSeconds: number
  longestWorkoutSeconds: number
  /** Latest bodyweight in kg; 0 when unknown, which parks relative badges at 0. */
  bodyweightKg: number
}

/** Squat + bench + deadlift e1RM — the total the 1000/1200/1500 lb clubs measure. */
export function bigThreeTotalKg(s: LifetimeStats): number {
  return s.bestSquatE1rmKg + s.bestBenchE1rmKg + s.bestDeadliftE1rmKg
}

export type BadgeGroup =
  | 'Milestones'
  | 'Consistency'
  | 'Strength'
  | 'Bodyweight'
  | 'Volume'
  | 'Cardio'
  | 'Habits'

export interface Badge {
  key: string
  label: string
  caption: string
  icon: string
  group: BadgeGroup
  /** 0–1; ≥ 1 is earned. */
  progress: (s: LifetimeStats) => number
  detail: (s: LifetimeStats) => string
}

const METERS_PER_MILE = distanceToM(1, 'mi')
const lbToKg = (lb: number) => weightToKg(lb, 'lb')

function ratio(current: number, target: number): number {
  if (target <= 0) return 0
  const r = current / target
  // A NaN stat from bad data must not poison the score.
  return Number.isFinite(r) ? r : 0
}

/**
 * Coerce every stat to a finite number, so one bad value can't render "NaN".
 * Key-driven rather than field-by-field, so a new stat can't be forgotten here.
 */
function sanitizeStats(s: LifetimeStats): LifetimeStats {
  const out = {} as Record<keyof LifetimeStats, number>
  for (const [key, value] of Object.entries(s) as [keyof LifetimeStats, number][]) {
    out[key] = Number.isFinite(value) ? value : 0
  }
  return out as LifetimeStats
}

function lbDetail(valueKg: number, targetLb: number): string {
  return `${formatDisplayWeight(valueKg, 'lb', { withUnit: false })} / ${targetLb.toLocaleString()} lb`
}

type Pick_ = (s: LifetimeStats) => number

/**
 * Tiered badges are the bulk of the catalog and differ only in target and wording,
 * so they're built from these factories — one line per badge, and the progress and
 * detail text can't drift apart.
 */
function countBadge(
  key: string,
  label: string,
  caption: string,
  icon: string,
  group: BadgeGroup,
  pick: Pick_,
  target: number,
  unit = '',
): Badge {
  return {
    key,
    label,
    caption,
    icon,
    group,
    progress: (s) => ratio(pick(s), target),
    detail: (s) =>
      `${Math.min(pick(s), target).toLocaleString()} / ${target.toLocaleString()}${unit}`,
  }
}

function weightBadge(
  key: string,
  label: string,
  caption: string,
  icon: string,
  group: BadgeGroup,
  pick: Pick_,
  targetLb: number,
): Badge {
  return {
    key,
    label,
    caption,
    icon,
    group,
    progress: (s) => ratio(pick(s), lbToKg(targetLb)),
    detail: (s) => lbDetail(pick(s), targetLb),
  }
}

/** A target expressed as a multiple of bodyweight; parks at 0 until one is known. */
function relativeBadge(
  key: string,
  label: string,
  caption: string,
  icon: string,
  pick: Pick_,
  multiple: number,
): Badge {
  return {
    key,
    label,
    caption,
    icon,
    group: 'Strength',
    progress: (s) => ratio(pick(s), s.bodyweightKg * multiple),
    detail: (s) =>
      s.bodyweightKg <= 0
        ? 'Add your bodyweight'
        : `${(pick(s) / s.bodyweightKg).toFixed(2)}× / ${multiple}× bw`,
  }
}

function milesBadge(
  key: string,
  label: string,
  caption: string,
  icon: string,
  miles: number,
): Badge {
  return {
    key,
    label,
    caption,
    icon,
    group: 'Cardio',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE * miles),
    detail: (s) =>
      `${(s.totalCardioMeters / METERS_PER_MILE).toFixed(miles < 10 ? 1 : 0)} / ${miles} mi`,
  }
}

function hoursBadge(
  key: string,
  label: string,
  caption: string,
  icon: string,
  group: BadgeGroup,
  pick: Pick_,
  hours: number,
): Badge {
  return {
    key,
    label,
    caption,
    icon,
    group,
    progress: (s) => ratio(pick(s), hours * 3600),
    detail: (s) => `${Math.floor(pick(s) / 3600)} / ${hours} hrs`,
  }
}

function tonnageBadge(
  key: string,
  label: string,
  caption: string,
  icon: string,
  lb: number,
): Badge {
  const targetKg = lbToKg(lb)
  return {
    key,
    label,
    caption,
    icon,
    group: 'Volume',
    progress: (s) => ratio(s.totalVolumeKg, targetKg),
    detail: (s) => `${Math.min(100, Math.round((s.totalVolumeKg / targetKg) * 100))}%`,
  }
}

// Order is the display order for the "next up" pick when several are unearned.
export const BADGES: Badge[] = [
  // ── Milestones: workouts logged, breadth of training, records ──
  countBadge('first-workout', 'First Rep', 'Log your very first workout — the hardest one to start.', '🌱', 'Milestones', (s) => s.totalWorkouts, 1),
  countBadge('ten-workouts', 'Getting Going', 'Log 10 workouts.', '🔟', 'Milestones', (s) => s.totalWorkouts, 10),
  countBadge('twentyfive-workouts', 'Habit Forming', 'Log 25 workouts.', '🧱', 'Milestones', (s) => s.totalWorkouts, 25),
  countBadge('fifty-workouts', 'Regular', 'Log 50 workouts.', '📈', 'Milestones', (s) => s.totalWorkouts, 50),
  countBadge('century', 'Century', 'Log 100 workouts.', '💯', 'Milestones', (s) => s.totalWorkouts, 100),
  countBadge('twofifty-workouts', 'Committed', 'Log 250 workouts.', '🎖️', 'Milestones', (s) => s.totalWorkouts, 250),
  countBadge('five-hundred-workouts', 'Devotee', 'Log 500 workouts.', '🧗', 'Milestones', (s) => s.totalWorkouts, 500),
  countBadge('thousand-workouts', 'Lifer', 'Log 1,000 workouts.', '🏛️', 'Milestones', (s) => s.totalWorkouts, 1000),

  countBadge('variety-10', 'Curious', 'Train 10 different exercises.', '🔍', 'Milestones', (s) => s.distinctExercises, 10),
  countBadge('variety-25', 'Well Rounded', 'Train 25 different exercises.', '🎯', 'Milestones', (s) => s.distinctExercises, 25),
  countBadge('variety-50', 'Jack of All Lifts', 'Train 50 different exercises.', '🃏', 'Milestones', (s) => s.distinctExercises, 50),
  countBadge('variety-100', 'Encyclopedia', 'Train 100 different exercises.', '📚', 'Milestones', (s) => s.distinctExercises, 100),
  countBadge('all-regions', 'Full Body', 'Train every body region at least once.', '🧍', 'Milestones', (s) => s.distinctRegions, 7),

  countBadge('first-pr', 'Personal Best', 'Set your first personal record.', '⭐', 'Milestones', (s) => s.prCount, 1),
  countBadge('ten-prs', 'Record Breaker', 'Set 10 personal records.', '🌟', 'Milestones', (s) => s.prCount, 10),
  countBadge('fifty-prs', 'Always Climbing', 'Set 50 personal records.', '✨', 'Milestones', (s) => s.prCount, 50),
  countBadge('hundred-prs', 'Record Cabinet', 'Set 100 personal records.', '🏆', 'Milestones', (s) => s.prCount, 100),

  countBadge('days-50', 'Fifty Days', 'Train on 50 separate days.', '📅', 'Milestones', (s) => s.totalDaysTrained, 50),
  countBadge('days-100', 'Hundred Days', 'Train on 100 separate days.', '🗂️', 'Milestones', (s) => s.totalDaysTrained, 100),
  countBadge('days-365', 'Year of Days', 'Train on 365 separate days.', '🎆', 'Milestones', (s) => s.totalDaysTrained, 365),

  // ── Consistency: week streaks, then consecutive-day runs ──
  countBadge('two-week-streak', 'Back for More', 'Train at least once a week for 2 weeks straight.', '🔂', 'Consistency', (s) => s.bestWeekStreak, 2, ' wks'),
  countBadge('month-streak', 'On a Roll', 'Train at least once a week for 4 weeks straight.', '🔥', 'Consistency', (s) => s.bestWeekStreak, 4, ' wks'),
  countBadge('eight-week-streak', 'Two Months Deep', 'An 8-week training streak.', '🌊', 'Consistency', (s) => s.bestWeekStreak, 8, ' wks'),
  countBadge('quarter-streak', 'Season Long', 'A 13-week training streak.', '🗓️', 'Consistency', (s) => s.bestWeekStreak, 13, ' wks'),
  countBadge('half-year-streak', 'Half Year Hero', 'A 26-week training streak.', '🏵️', 'Consistency', (s) => s.bestWeekStreak, 26, ' wks'),
  countBadge('year-streak', 'Unbreakable', 'A 52-week training streak — a full year without missing a week.', '💎', 'Consistency', (s) => s.bestWeekStreak, 52, ' wks'),
  countBadge('two-year-streak', 'Immovable', 'A 104-week training streak.', '🗿', 'Consistency', (s) => s.bestWeekStreak, 104, ' wks'),

  countBadge('day-streak-3', 'Three in a Row', 'Train 3 days in a row.', '3️⃣', 'Consistency', (s) => s.bestDayStreak, 3, ' days'),
  countBadge('day-streak-7', 'Seven Straight', 'Train 7 days in a row.', '7️⃣', 'Consistency', (s) => s.bestDayStreak, 7, ' days'),
  countBadge('day-streak-14', 'Fortnight', 'Train 14 days in a row.', '🌗', 'Consistency', (s) => s.bestDayStreak, 14, ' days'),
  countBadge('day-streak-30', 'Iron Month', 'Train 30 days in a row.', '🌕', 'Consistency', (s) => s.bestDayStreak, 30, ' days'),

  // ── Strength: plate milestones by lift (estimated 1RM) ──
  weightBadge('bench-135', 'One Plate Bench', 'A 135 lb estimated bench press.', '🔩', 'Strength', (s) => s.bestBenchE1rmKg, 135),
  weightBadge('bench-185', 'Closing In', 'A 185 lb estimated bench press.', '🔧', 'Strength', (s) => s.bestBenchE1rmKg, 185),
  weightBadge('bench-225', 'Two Plate Bench', 'A 225 lb estimated bench press.', '🏋️', 'Strength', (s) => s.bestBenchE1rmKg, 225),
  weightBadge('bench-315', 'Three Plate Bench', 'A 315 lb estimated bench press.', '🦍', 'Strength', (s) => s.bestBenchE1rmKg, 315),

  weightBadge('squat-225', 'Two Plate Squat', 'A 225 lb estimated squat.', '🪑', 'Strength', (s) => s.bestSquatE1rmKg, 225),
  weightBadge('squat-315', 'Three Plate Squat', 'A 315 lb estimated squat.', '🦵', 'Strength', (s) => s.bestSquatE1rmKg, 315),
  weightBadge('squat-405', 'Four Plate Squat', 'A 405 lb estimated squat.', '🐘', 'Strength', (s) => s.bestSquatE1rmKg, 405),
  weightBadge('squat-495', 'Five Plate Squat', 'A 495 lb estimated squat.', '🌋', 'Strength', (s) => s.bestSquatE1rmKg, 495),

  weightBadge('deadlift-225', 'Two Plate Pull', 'A 225 lb estimated deadlift.', '🧲', 'Strength', (s) => s.bestDeadliftE1rmKg, 225),
  weightBadge('deadlift-315', 'Three Plate Pull', 'A 315 lb estimated deadlift.', '⚓', 'Strength', (s) => s.bestDeadliftE1rmKg, 315),
  weightBadge('deadlift-405', 'Four Plate Pull', 'A 405 lb estimated deadlift.', '🪝', 'Strength', (s) => s.bestDeadliftE1rmKg, 405),
  weightBadge('deadlift-495', 'Five Plate Pull', 'A 495 lb estimated deadlift.', '⛓️', 'Strength', (s) => s.bestDeadliftE1rmKg, 495),
  weightBadge('deadlift-585', 'Six Plate Pull', 'A 585 lb estimated deadlift.', '🐉', 'Strength', (s) => s.bestDeadliftE1rmKg, 585),

  weightBadge('ohp-95', 'Overhead Start', 'A 95 lb estimated overhead press.', '🫱', 'Strength', (s) => s.bestOverheadPressE1rmKg, 95),
  weightBadge('ohp-135', 'One Plate Overhead', 'A 135 lb estimated overhead press.', '🙌', 'Strength', (s) => s.bestOverheadPressE1rmKg, 135),
  weightBadge('ohp-185', 'Strong Shoulders', 'A 185 lb estimated overhead press.', '🗼', 'Strength', (s) => s.bestOverheadPressE1rmKg, 185),

  weightBadge('row-135', 'One Plate Row', 'A 135 lb estimated barbell row.', '🚣', 'Strength', (s) => s.bestRowE1rmKg, 135),
  weightBadge('row-225', 'Two Plate Row', 'A 225 lb estimated barbell row.', '🛶', 'Strength', (s) => s.bestRowE1rmKg, 225),

  weightBadge('heaviest-225', 'Heavy Hands', 'Complete a set at 225 lb or more.', '✊', 'Strength', (s) => s.maxSetWeightKg, 225),
  weightBadge('heaviest-315', 'Serious Iron', 'Complete a set at 315 lb or more.', '💪', 'Strength', (s) => s.maxSetWeightKg, 315),
  weightBadge('heaviest-405', 'Big Iron', 'Complete a set at 405 lb or more.', '🛞', 'Strength', (s) => s.maxSetWeightKg, 405),

  weightBadge('club-900', '900 lb Club', 'A squat + bench + deadlift total of 900 lb.', '🎽', 'Strength', bigThreeTotalKg, 900),
  weightBadge('club-1000', '1000 lb Club', 'A squat + bench + deadlift total of 1,000 lb.', '🥉', 'Strength', bigThreeTotalKg, 1000),
  weightBadge('club-1200', '1200 lb Club', 'A 1,200 lb powerlifting total.', '🥈', 'Strength', bigThreeTotalKg, 1200),
  weightBadge('club-1500', '1500 lb Club', 'A 1,500 lb powerlifting total.', '🥇', 'Strength', bigThreeTotalKg, 1500),

  // Relative strength — the fairer comparison across bodyweights.
  relativeBadge('bench-bw', 'Bodyweight Bench', 'Bench press your own bodyweight.', '⚖️', (s) => s.bestBenchE1rmKg, 1),
  relativeBadge('bench-1_5bw', 'Bench and a Half', 'Bench 1.5× your bodyweight.', '🧮', (s) => s.bestBenchE1rmKg, 1.5),
  relativeBadge('squat-1_5bw', 'Squat and a Half', 'Squat 1.5× your bodyweight.', '📐', (s) => s.bestSquatE1rmKg, 1.5),
  relativeBadge('squat-2bw', 'Double Bodyweight Squat', 'Squat 2× your bodyweight.', '🧗‍♂️', (s) => s.bestSquatE1rmKg, 2),
  relativeBadge('deadlift-2bw', 'Double Bodyweight Pull', 'Deadlift 2× your bodyweight.', '🧨', (s) => s.bestDeadliftE1rmKg, 2),
  relativeBadge('deadlift-2_5bw', 'Elite Pull', 'Deadlift 2.5× your bodyweight.', '☄️', (s) => s.bestDeadliftE1rmKg, 2.5),

  // ── Bodyweight training ──
  countBadge('bw-reps-100', 'First Hundred', 'Log 100 bodyweight reps.', '🤸', 'Bodyweight', (s) => s.totalBodyweightReps, 100),
  countBadge('bw-reps-1000', 'Calisthenics', 'Log 1,000 bodyweight reps.', '🧘', 'Bodyweight', (s) => s.totalBodyweightReps, 1000),
  countBadge('bw-reps-5000', 'Gravity Fighter', 'Log 5,000 bodyweight reps.', '🪂', 'Bodyweight', (s) => s.totalBodyweightReps, 5000),
  countBadge('bw-reps-10000', 'Bodyweight Master', 'Log 10,000 bodyweight reps.', '🕊️', 'Bodyweight', (s) => s.totalBodyweightReps, 10000),
  countBadge('reps-in-set-20', 'Twenty Straight', 'Complete a set of 20 reps.', '🔁', 'Bodyweight', (s) => s.maxRepsInSet, 20, ' reps'),
  countBadge('reps-in-set-30', 'Thirty Straight', 'Complete a set of 30 reps.', '🌀', 'Bodyweight', (s) => s.maxRepsInSet, 30, ' reps'),
  countBadge('reps-in-set-50', 'Fifty Straight', 'Complete a set of 50 reps.', '💫', 'Bodyweight', (s) => s.maxRepsInSet, 50, ' reps'),

  // ── Volume: sets, reps, cumulative tonnage ──
  countBadge('hundred-sets', 'Hundred Sets', 'Log 100 working sets.', '💠', 'Volume', (s) => s.totalSets, 100),
  countBadge('five-hundred-sets', 'Set Collector', 'Log 500 working sets.', '🔷', 'Volume', (s) => s.totalSets, 500),
  countBadge('thousand-sets', 'Set Machine', 'Log 1,000 working sets.', '⚙️', 'Volume', (s) => s.totalSets, 1000),
  countBadge('five-thousand-sets', 'Relentless', 'Log 5,000 working sets.', '🔩', 'Volume', (s) => s.totalSets, 5000),
  countBadge('ten-thousand-sets', 'Iron Addict', 'Log 10,000 working sets.', '🛠️', 'Volume', (s) => s.totalSets, 10000),

  countBadge('reps-1000', 'Thousand Reps', 'Log 1,000 reps.', '🧾', 'Volume', (s) => s.totalReps, 1000),
  countBadge('reps-10000', 'Ten Thousand Reps', 'Log 10,000 reps.', '📊', 'Volume', (s) => s.totalReps, 10000),
  countBadge('reps-50000', 'Rep Monster', 'Log 50,000 reps.', '🐺', 'Volume', (s) => s.totalReps, 50000),
  countBadge('reps-100000', 'Six Figures', 'Log 100,000 reps.', '🎰', 'Volume', (s) => s.totalReps, 100000),

  tonnageBadge('tonnage-100k', '100K Moved', 'Move 100,000 lb of total volume.', '📦', 100_000),
  tonnageBadge('half-million-club', '500K Club', 'Move 500,000 lb of total volume.', '🏅', 500_000),
  tonnageBadge('million-club', '1M Club', 'Move 1,000,000 lb of total volume.', '🏆', 1_000_000),
  tonnageBadge('five-million-club', 'Five Million', 'Move 5,000,000 lb of total volume.', '🚢', 5_000_000),
  tonnageBadge('ten-million-club', 'Ten Ton Titan', 'Move 10,000,000 lb of total volume.', '🗿', 10_000_000),

  // ── Cardio ──
  milesBadge('cardio-first', 'First Mile', 'Log your first mile of cardio.', '👟', 1),
  milesBadge('cardio-5mi', 'Five Miler', 'Log 5 miles of cardio.', '🥾', 5),
  milesBadge('cardio-marathon', 'Marathoner', 'Log 26.2 miles of cardio.', '🏃', 26.2),
  milesBadge('cardio-50mi', 'Ultra Distance', 'Log 50 miles of cardio.', '🧭', 50),
  milesBadge('cardio-century', 'Century Rider', 'Log 100 miles of cardio.', '🚴', 100),
  milesBadge('cardio-500mi', 'Long Hauler', 'Log 500 miles of cardio.', '🗺️', 500),
  milesBadge('cardio-1000mi', 'Four Digits', 'Log 1,000 miles of cardio.', '🌍', 1000),
  hoursBadge('cardio-10h', 'Ten Hours In', 'Log 10 hours of cardio.', '⏱️', 'Cardio', (s) => s.totalCardioSeconds, 10),
  hoursBadge('cardio-50h', 'Endurance Engine', 'Log 50 hours of cardio.', '🫀', 'Cardio', (s) => s.totalCardioSeconds, 50),
  hoursBadge('cardio-100h', 'Cardio Centurion', 'Log 100 hours of cardio.', '🌬️', 'Cardio', (s) => s.totalCardioSeconds, 100),

  // ── Habits: when and how long you train ──
  countBadge('early-1', 'Early Bird', 'Start a workout before 7am.', '🌅', 'Habits', (s) => s.earlyWorkouts, 1),
  countBadge('early-10', 'Dawn Patrol', 'Start 10 workouts before 7am.', '🐓', 'Habits', (s) => s.earlyWorkouts, 10),
  countBadge('early-50', 'Sunrise Regular', 'Start 50 workouts before 7am.', '☀️', 'Habits', (s) => s.earlyWorkouts, 50),
  countBadge('late-1', 'Night Owl', 'Start a workout at 9pm or later.', '🌙', 'Habits', (s) => s.lateWorkouts, 1),
  countBadge('late-10', 'Closing Shift', 'Start 10 workouts at 9pm or later.', '🦉', 'Habits', (s) => s.lateWorkouts, 10),
  countBadge('weekend-10', 'Weekend Warrior', 'Train on 10 weekend days.', '🛡️', 'Habits', (s) => s.weekendWorkouts, 10),
  countBadge('weekend-50', 'No Days Off', 'Train on 50 weekend days.', '⚔️', 'Habits', (s) => s.weekendWorkouts, 50),
  hoursBadge('long-session-90', 'Long Haul', 'Train for 90 minutes in one session.', '⌛', 'Habits', (s) => s.longestWorkoutSeconds, 1.5),
  hoursBadge('long-session-2h', 'Marathon Session', 'Train for 2 hours in one session.', '🕰️', 'Habits', (s) => s.longestWorkoutSeconds, 2),
  hoursBadge('time-24h', 'A Full Day', 'Spend 24 hours training.', '📆', 'Habits', (s) => s.totalTrainingSeconds, 24),
  hoursBadge('time-100h', 'Hundred Hours', 'Spend 100 hours training.', '🕐', 'Habits', (s) => s.totalTrainingSeconds, 100),
  hoursBadge('time-500h', 'Five Hundred Hours', 'Spend 500 hours training.', '🔮', 'Habits', (s) => s.totalTrainingSeconds, 500),
]

export interface BadgeState extends Badge {
  earned: boolean
  fraction: number
  detailText: string
}

export function evaluateBadges(rawStats: LifetimeStats): BadgeState[] {
  const stats = sanitizeStats(rawStats)
  return BADGES.map((badge) => {
    const raw = badge.progress(stats)
    const fraction = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
    return { ...badge, earned: fraction >= 1, fraction, detailText: badge.detail(stats) }
  }).sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1
    // Among unearned, closest to earning comes first (most motivating).
    if (!a.earned) return b.fraction - a.fraction
    return 0
  })
}

// Earned badges plus started ones (fraction > 0); untouched targets are hidden as
// noise. Falls back to the single closest badge so Home is never empty for a new user.
export function homeBadges(all: BadgeState[]): BadgeState[] {
  const inPlay = all.filter((b) => b.earned || b.fraction > 0)
  if (inPlay.length > 0) return inPlay
  const next = all.find((b) => !b.earned)
  return next ? [next] : []
}

export function groupedBadges(
  all: BadgeState[],
): { group: BadgeGroup; badges: BadgeState[] }[] {
  const order: BadgeGroup[] = [
    'Milestones',
    'Consistency',
    'Strength',
    'Bodyweight',
    'Volume',
    'Cardio',
    'Habits',
  ]
  return order
    .map((group) => ({ group, badges: all.filter((b) => b.group === group) }))
    .filter((section) => section.badges.length > 0)
}
