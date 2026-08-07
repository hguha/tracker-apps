/**
 * The Home badge catalog (§5.2.1, gamification).
 *
 * Config-driven, like the Insights chart catalog: each badge declares its label,
 * a short caption, and a pure function from lifetime stats to progress. The Home
 * screen renders earned badges filled and the nearest unearned one with its
 * percentage, so there's always a next thing to chase.
 *
 * Adding a badge is one entry here — no Home edits. `progress` returns 0–1;
 * `≥ 1` means earned. `detail` renders the concrete state ("82%", "1,240 / 100").
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

/** kg in a metric ton — the "1M Club" is a million lb, but stored volume is kg. */
const MILLION_LB_IN_KG = 1_000_000 / 2.20462262185

function ratio(current: number, target: number): number {
  return target > 0 ? current / target : 0
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
    key: 'million-club',
    label: '1M Club',
    caption: 'Lift 1,000,000 lb total',
    icon: '🏆',
    progress: (s) => ratio(s.totalVolumeKg, MILLION_LB_IN_KG),
    detail: (s) => `${Math.round((s.totalVolumeKg / MILLION_LB_IN_KG) * 100)}%`,
  },
  {
    key: 'year-streak',
    label: 'Unbreakable',
    caption: 'A 52-week training streak',
    icon: '💎',
    progress: (s) => ratio(s.bestWeekStreak, 52),
    detail: (s) => `${Math.min(s.bestWeekStreak, 52)} / 52 wks`,
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
