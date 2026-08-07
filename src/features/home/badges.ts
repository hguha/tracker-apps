/**
 * The Home badge catalog (§5.2.1, gamification).
 *
 * Config-driven, like the Insights chart catalog: each badge declares its label,
 * a short caption, and a pure function from lifetime stats to progress. The Home
 * strip shows earned badges plus the next one to chase, and expands to the full
 * grid on tap.
 *
 * Adding a badge is one entry here — no Home edits. `progress` returns 0–1;
 * `≥ 1` means earned. `detail` renders the concrete state ("82%", "620 / 1,000 lb").
 */

export interface LifetimeStats {
  /** Finished workouts, all time. */
  totalWorkouts: number
  /** Total working sets logged, all time. */
  totalSets: number
  /** Total volume lifted in kg, all time (converted for display by the caller). */
  totalVolumeKg: number
  /** Longest run of consecutive weeks with a session. */
  bestWeekStreak: number
  /** Current run of consecutive weeks with a session. */
  currentWeekStreak: number
  /** Best estimated 1RM in kg on each of the big three, 0 if never trained. */
  bestSquatE1rmKg: number
  bestBenchE1rmKg: number
  bestDeadliftE1rmKg: number
  /** Best estimated 1RM in kg across *any* lift, for a general strength badge. */
  bestAnyE1rmKg: number
  /** Total cardio distance (meters) and time (seconds), all time. */
  totalCardioMeters: number
  totalCardioSeconds: number
  /** Distinct exercises the user has logged, for a "variety" badge. */
  distinctExercises: number
}

/** The combined best-e1RM of squat + bench + deadlift — the powerlifting total
 *  the 1000 lb / 1200 lb / 1500 lb clubs are measured against. */
export function bigThreeTotalKg(s: LifetimeStats): number {
  return s.bestSquatE1rmKg + s.bestBenchE1rmKg + s.bestDeadliftE1rmKg
}

export interface Badge {
  key: string
  label: string
  /** One-line description of the milestone. */
  caption: string
  /** Emoji shown as the badge face. */
  icon: string
  /** 0–1; ≥ 1 is earned. */
  progress: (s: LifetimeStats) => number
  /** Human-readable current-vs-target, e.g. "82 / 100". */
  detail: (s: LifetimeStats) => string
}

const LB_PER_KG = 2.20462262185
/** Convert a pound target to the kg our data is stored in. */
const lbToKg = (lb: number) => lb / LB_PER_KG
/** kg in a million pounds — the "1M Club" is total volume, in lb. */
const MILLION_LB_IN_KG = lbToKg(1_000_000)
const METERS_PER_MILE = 1609.344

function ratio(current: number, target: number): number {
  return target > 0 ? current / target : 0
}

/** "620 / 1,000 lb" — a kg value shown against a pound target. */
function lbDetail(valueKg: number, targetLb: number): string {
  return `${Math.round(valueKg * LB_PER_KG).toLocaleString()} / ${targetLb.toLocaleString()} lb`
}

/**
 * The catalog, roughly by how soon a consistent lifter reaches each. Order is
 * the display order for the "next up" pick when several are unearned.
 */
export const BADGES: Badge[] = [
  {
    key: 'first-workout',
    label: 'First Rep',
    caption: 'Log your first workout',
    icon: '🌱',
    progress: (s) => ratio(s.totalWorkouts, 1),
    detail: (s) => `${Math.min(s.totalWorkouts, 1)} / 1`,
  },
  {
    key: 'ten-workouts',
    label: 'Getting Going',
    caption: 'Log 10 workouts',
    icon: '🔟',
    progress: (s) => ratio(s.totalWorkouts, 10),
    detail: (s) => `${Math.min(s.totalWorkouts, 10)} / 10`,
  },
  {
    key: 'month-streak',
    label: 'On a Roll',
    caption: 'A 4-week training streak',
    icon: '🔥',
    progress: (s) => ratio(s.bestWeekStreak, 4),
    detail: (s) => `${Math.min(s.bestWeekStreak, 4)} / 4 wks`,
  },
  {
    key: 'century',
    label: 'Century',
    caption: 'Log 100 workouts',
    icon: '💯',
    progress: (s) => ratio(s.totalWorkouts, 100),
    detail: (s) => `${Math.min(s.totalWorkouts, 100)} / 100`,
  },
  {
    key: 'thousand-sets',
    label: 'Set Machine',
    caption: 'Log 1,000 working sets',
    icon: '⚙️',
    progress: (s) => ratio(s.totalSets, 1000),
    detail: (s) => `${Math.min(s.totalSets, 1000).toLocaleString()} / 1,000`,
  },
  {
    key: 'quarter-streak',
    label: 'Season Long',
    caption: 'A 13-week training streak',
    icon: '🗓️',
    progress: (s) => ratio(s.bestWeekStreak, 13),
    detail: (s) => `${Math.min(s.bestWeekStreak, 13)} / 13 wks`,
  },
  {
    key: 'year-streak',
    label: 'Unbreakable',
    caption: 'A 52-week training streak',
    icon: '💎',
    progress: (s) => ratio(s.bestWeekStreak, 52),
    detail: (s) => `${Math.min(s.bestWeekStreak, 52)} / 52 wks`,
  },

  // ── Strength: single-lift plate milestones (estimated 1RM) ──
  {
    key: 'bench-225',
    label: 'Two Plate Bench',
    caption: 'A 225 lb estimated bench press',
    icon: '🏋️',
    progress: (s) => ratio(s.bestBenchE1rmKg, lbToKg(225)),
    detail: (s) => lbDetail(s.bestBenchE1rmKg, 225),
  },
  {
    key: 'squat-315',
    label: 'Three Plate Squat',
    caption: 'A 315 lb estimated squat',
    icon: '🦵',
    progress: (s) => ratio(s.bestSquatE1rmKg, lbToKg(315)),
    detail: (s) => lbDetail(s.bestSquatE1rmKg, 315),
  },
  {
    key: 'deadlift-405',
    label: 'Four Plate Pull',
    caption: 'A 405 lb estimated deadlift',
    icon: '🪝',
    progress: (s) => ratio(s.bestDeadliftE1rmKg, lbToKg(405)),
    detail: (s) => lbDetail(s.bestDeadliftE1rmKg, 405),
  },

  // ── Strength: powerlifting total (squat + bench + deadlift) ──
  {
    key: 'club-1000',
    label: '1000 lb Club',
    caption: 'Squat + bench + deadlift total of 1,000 lb',
    icon: '🥉',
    progress: (s) => ratio(bigThreeTotalKg(s), lbToKg(1000)),
    detail: (s) => lbDetail(bigThreeTotalKg(s), 1000),
  },
  {
    key: 'club-1200',
    label: '1200 lb Club',
    caption: 'A 1,200 lb powerlifting total',
    icon: '🥈',
    progress: (s) => ratio(bigThreeTotalKg(s), lbToKg(1200)),
    detail: (s) => lbDetail(bigThreeTotalKg(s), 1200),
  },
  {
    key: 'club-1500',
    label: '1500 lb Club',
    caption: 'A 1,500 lb powerlifting total',
    icon: '🥇',
    progress: (s) => ratio(bigThreeTotalKg(s), lbToKg(1500)),
    detail: (s) => lbDetail(bigThreeTotalKg(s), 1500),
  },

  // ── Volume: cumulative tonnage moved ──
  {
    key: 'half-million-club',
    label: '500K Club',
    caption: 'Lift 500,000 lb of total volume',
    icon: '🏅',
    progress: (s) => ratio(s.totalVolumeKg, MILLION_LB_IN_KG / 2),
    detail: (s) => `${Math.round((s.totalVolumeKg / (MILLION_LB_IN_KG / 2)) * 100)}%`,
  },
  {
    key: 'million-club',
    label: '1M Club',
    caption: 'Lift 1,000,000 lb of total volume',
    icon: '🏆',
    progress: (s) => ratio(s.totalVolumeKg, MILLION_LB_IN_KG),
    detail: (s) => `${Math.round((s.totalVolumeKg / MILLION_LB_IN_KG) * 100)}%`,
  },

  // ── Cardio ──
  {
    key: 'cardio-first',
    label: 'First Mile',
    caption: 'Log your first mile of cardio',
    icon: '👟',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE),
    detail: (s) => `${(s.totalCardioMeters / METERS_PER_MILE).toFixed(1)} / 1 mi`,
  },
  {
    key: 'cardio-marathon',
    label: 'Marathoner',
    caption: 'Log 26.2 miles of cardio',
    icon: '🏃',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE * 26.2),
    detail: (s) => `${Math.round(s.totalCardioMeters / METERS_PER_MILE)} / 26 mi`,
  },
  {
    key: 'cardio-century',
    label: 'Century Rider',
    caption: 'Log 100 miles of cardio',
    icon: '🚴',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE * 100),
    detail: (s) => `${Math.round(s.totalCardioMeters / METERS_PER_MILE)} / 100 mi`,
  },
  {
    key: 'cardio-10h',
    label: 'Ten Hours In',
    caption: 'Log 10 hours of cardio',
    icon: '⏱️',
    progress: (s) => ratio(s.totalCardioSeconds, 10 * 3600),
    detail: (s) => `${Math.floor(s.totalCardioSeconds / 3600)} / 10 hrs`,
  },

  // ── Variety & scale ──
  {
    key: 'variety-25',
    label: 'Well Rounded',
    caption: 'Train 25 different exercises',
    icon: '🎯',
    progress: (s) => ratio(s.distinctExercises, 25),
    detail: (s) => `${Math.min(s.distinctExercises, 25)} / 25`,
  },
  {
    key: 'strong-first',
    label: 'Bodyweight Strong',
    caption: 'An estimated 1RM over 200 lb on any lift',
    icon: '💪',
    progress: (s) => ratio(s.bestAnyE1rmKg, lbToKg(200)),
    detail: (s) => lbDetail(s.bestAnyE1rmKg, 200),
  },
]

export interface BadgeState extends Badge {
  earned: boolean
  fraction: number
  /** `detail(stats)` resolved against the current stats, ready to render. */
  detailText: string
}

/** Evaluate every badge against the stats. Earned first, then nearest-to-earn. */
export function evaluateBadges(stats: LifetimeStats): BadgeState[] {
  return BADGES.map((badge) => {
    const fraction = Math.min(1, Math.max(0, badge.progress(stats)))
    return { ...badge, earned: fraction >= 1, fraction, detailText: badge.detail(stats) }
  }).sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1
    // Among unearned, closest to earning comes first (most motivating).
    if (!a.earned) return b.fraction - a.fraction
    return 0
  })
}
