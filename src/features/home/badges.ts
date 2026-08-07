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

/** Themed sections for the full badge list. */
export type BadgeGroup = 'Milestones' | 'Consistency' | 'Strength' | 'Volume' | 'Cardio'

export interface Badge {
  key: string
  label: string
  /** One-line description of the milestone — shown on tap. */
  caption: string
  /** Emoji shown as the badge face. */
  icon: string
  /** Section in the full list. */
  group: BadgeGroup
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
  if (target <= 0) return 0
  const r = current / target
  // A non-finite input (a NaN stat from bad data) must not poison the score.
  return Number.isFinite(r) ? r : 0
}

/** Coerce every stat to a finite number, so one bad value can't render "NaN". */
function sanitizeStats(s: LifetimeStats): LifetimeStats {
  const n = (v: number) => (Number.isFinite(v) ? v : 0)
  return {
    totalWorkouts: n(s.totalWorkouts),
    totalSets: n(s.totalSets),
    totalVolumeKg: n(s.totalVolumeKg),
    bestWeekStreak: n(s.bestWeekStreak),
    currentWeekStreak: n(s.currentWeekStreak),
    bestSquatE1rmKg: n(s.bestSquatE1rmKg),
    bestBenchE1rmKg: n(s.bestBenchE1rmKg),
    bestDeadliftE1rmKg: n(s.bestDeadliftE1rmKg),
    bestAnyE1rmKg: n(s.bestAnyE1rmKg),
    totalCardioMeters: n(s.totalCardioMeters),
    totalCardioSeconds: n(s.totalCardioSeconds),
    distinctExercises: n(s.distinctExercises),
  }
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
  // ── Milestones: workouts logged ──
  {
    key: 'first-workout',
    label: 'First Rep',
    caption: 'Log your very first workout — the hardest one to start.',
    icon: '🌱',
    group: 'Milestones',
    progress: (s) => ratio(s.totalWorkouts, 1),
    detail: (s) => `${Math.min(s.totalWorkouts, 1)} / 1`,
  },
  {
    key: 'ten-workouts',
    label: 'Getting Going',
    caption: 'Log 10 workouts.',
    icon: '🔟',
    group: 'Milestones',
    progress: (s) => ratio(s.totalWorkouts, 10),
    detail: (s) => `${Math.min(s.totalWorkouts, 10)} / 10`,
  },
  {
    key: 'fifty-workouts',
    label: 'Regular',
    caption: 'Log 50 workouts.',
    icon: '📈',
    group: 'Milestones',
    progress: (s) => ratio(s.totalWorkouts, 50),
    detail: (s) => `${Math.min(s.totalWorkouts, 50)} / 50`,
  },
  {
    key: 'century',
    label: 'Century',
    caption: 'Log 100 workouts.',
    icon: '💯',
    group: 'Milestones',
    progress: (s) => ratio(s.totalWorkouts, 100),
    detail: (s) => `${Math.min(s.totalWorkouts, 100)} / 100`,
  },
  {
    key: 'five-hundred-workouts',
    label: 'Devotee',
    caption: 'Log 500 workouts.',
    icon: '🧗',
    group: 'Milestones',
    progress: (s) => ratio(s.totalWorkouts, 500),
    detail: (s) => `${Math.min(s.totalWorkouts, 500)} / 500`,
  },
  {
    key: 'variety-25',
    label: 'Well Rounded',
    caption: 'Train 25 different exercises.',
    icon: '🎯',
    group: 'Milestones',
    progress: (s) => ratio(s.distinctExercises, 25),
    detail: (s) => `${Math.min(s.distinctExercises, 25)} / 25`,
  },
  {
    key: 'variety-50',
    label: 'Jack of All Lifts',
    caption: 'Train 50 different exercises.',
    icon: '🃏',
    group: 'Milestones',
    progress: (s) => ratio(s.distinctExercises, 50),
    detail: (s) => `${Math.min(s.distinctExercises, 50)} / 50`,
  },

  // ── Consistency: week streaks ──
  {
    key: 'month-streak',
    label: 'On a Roll',
    caption: 'Train at least once a week for 4 weeks straight.',
    icon: '🔥',
    group: 'Consistency',
    progress: (s) => ratio(s.bestWeekStreak, 4),
    detail: (s) => `${Math.min(s.bestWeekStreak, 4)} / 4 wks`,
  },
  {
    key: 'quarter-streak',
    label: 'Season Long',
    caption: 'A 13-week training streak.',
    icon: '🗓️',
    group: 'Consistency',
    progress: (s) => ratio(s.bestWeekStreak, 13),
    detail: (s) => `${Math.min(s.bestWeekStreak, 13)} / 13 wks`,
  },
  {
    key: 'half-year-streak',
    label: 'Half Year Hero',
    caption: 'A 26-week training streak.',
    icon: '🏵️',
    group: 'Consistency',
    progress: (s) => ratio(s.bestWeekStreak, 26),
    detail: (s) => `${Math.min(s.bestWeekStreak, 26)} / 26 wks`,
  },
  {
    key: 'year-streak',
    label: 'Unbreakable',
    caption: 'A 52-week training streak — a full year without missing a week.',
    icon: '💎',
    group: 'Consistency',
    progress: (s) => ratio(s.bestWeekStreak, 52),
    detail: (s) => `${Math.min(s.bestWeekStreak, 52)} / 52 wks`,
  },

  // ── Strength: single-lift plate milestones (estimated 1RM) ──
  {
    key: 'bench-135',
    label: 'One Plate Bench',
    caption: 'A 135 lb estimated bench press.',
    icon: '🔩',
    group: 'Strength',
    progress: (s) => ratio(s.bestBenchE1rmKg, lbToKg(135)),
    detail: (s) => lbDetail(s.bestBenchE1rmKg, 135),
  },
  {
    key: 'bench-225',
    label: 'Two Plate Bench',
    caption: 'A 225 lb estimated bench press.',
    icon: '🏋️',
    group: 'Strength',
    progress: (s) => ratio(s.bestBenchE1rmKg, lbToKg(225)),
    detail: (s) => lbDetail(s.bestBenchE1rmKg, 225),
  },
  {
    key: 'squat-315',
    label: 'Three Plate Squat',
    caption: 'A 315 lb estimated squat.',
    icon: '🦵',
    group: 'Strength',
    progress: (s) => ratio(s.bestSquatE1rmKg, lbToKg(315)),
    detail: (s) => lbDetail(s.bestSquatE1rmKg, 315),
  },
  {
    key: 'deadlift-405',
    label: 'Four Plate Pull',
    caption: 'A 405 lb estimated deadlift.',
    icon: '🪝',
    group: 'Strength',
    progress: (s) => ratio(s.bestDeadliftE1rmKg, lbToKg(405)),
    detail: (s) => lbDetail(s.bestDeadliftE1rmKg, 405),
  },
  {
    key: 'deadlift-495',
    label: 'Five Plate Pull',
    caption: 'A 495 lb estimated deadlift.',
    icon: '⛓️',
    group: 'Strength',
    progress: (s) => ratio(s.bestDeadliftE1rmKg, lbToKg(495)),
    detail: (s) => lbDetail(s.bestDeadliftE1rmKg, 495),
  },
  {
    key: 'club-1000',
    label: '1000 lb Club',
    caption: 'A squat + bench + deadlift total of 1,000 lb.',
    icon: '🥉',
    group: 'Strength',
    progress: (s) => ratio(bigThreeTotalKg(s), lbToKg(1000)),
    detail: (s) => lbDetail(bigThreeTotalKg(s), 1000),
  },
  {
    key: 'club-1200',
    label: '1200 lb Club',
    caption: 'A 1,200 lb powerlifting total.',
    icon: '🥈',
    group: 'Strength',
    progress: (s) => ratio(bigThreeTotalKg(s), lbToKg(1200)),
    detail: (s) => lbDetail(bigThreeTotalKg(s), 1200),
  },
  {
    key: 'club-1500',
    label: '1500 lb Club',
    caption: 'A 1,500 lb powerlifting total.',
    icon: '🥇',
    group: 'Strength',
    progress: (s) => ratio(bigThreeTotalKg(s), lbToKg(1500)),
    detail: (s) => lbDetail(bigThreeTotalKg(s), 1500),
  },

  // ── Volume: sets and cumulative tonnage ──
  {
    key: 'hundred-sets',
    label: 'Hundred Sets',
    caption: 'Log 100 working sets.',
    icon: '💠',
    group: 'Volume',
    progress: (s) => ratio(s.totalSets, 100),
    detail: (s) => `${Math.min(s.totalSets, 100).toLocaleString()} / 100`,
  },
  {
    key: 'thousand-sets',
    label: 'Set Machine',
    caption: 'Log 1,000 working sets.',
    icon: '⚙️',
    group: 'Volume',
    progress: (s) => ratio(s.totalSets, 1000),
    detail: (s) => `${Math.min(s.totalSets, 1000).toLocaleString()} / 1,000`,
  },
  {
    key: 'ten-thousand-sets',
    label: 'Iron Addict',
    caption: 'Log 10,000 working sets.',
    icon: '🛠️',
    group: 'Volume',
    progress: (s) => ratio(s.totalSets, 10000),
    detail: (s) => `${Math.min(s.totalSets, 10000).toLocaleString()} / 10,000`,
  },
  {
    key: 'half-million-club',
    label: '500K Club',
    caption: 'Move 500,000 lb of total volume.',
    icon: '🏅',
    group: 'Volume',
    progress: (s) => ratio(s.totalVolumeKg, MILLION_LB_IN_KG / 2),
    detail: (s) => `${Math.round((s.totalVolumeKg / (MILLION_LB_IN_KG / 2)) * 100)}%`,
  },
  {
    key: 'million-club',
    label: '1M Club',
    caption: 'Move 1,000,000 lb of total volume.',
    icon: '🏆',
    group: 'Volume',
    progress: (s) => ratio(s.totalVolumeKg, MILLION_LB_IN_KG),
    detail: (s) => `${Math.round((s.totalVolumeKg / MILLION_LB_IN_KG) * 100)}%`,
  },
  {
    key: 'ten-million-club',
    label: 'Ten Ton Titan',
    caption: 'Move 10,000,000 lb of total volume.',
    icon: '🗿',
    group: 'Volume',
    progress: (s) => ratio(s.totalVolumeKg, MILLION_LB_IN_KG * 10),
    detail: (s) => `${Math.round((s.totalVolumeKg / (MILLION_LB_IN_KG * 10)) * 100)}%`,
  },

  // ── Cardio ──
  {
    key: 'cardio-first',
    label: 'First Mile',
    caption: 'Log your first mile of cardio.',
    icon: '👟',
    group: 'Cardio',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE),
    detail: (s) => `${(s.totalCardioMeters / METERS_PER_MILE).toFixed(1)} / 1 mi`,
  },
  {
    key: 'cardio-marathon',
    label: 'Marathoner',
    caption: 'Log 26.2 miles of cardio.',
    icon: '🏃',
    group: 'Cardio',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE * 26.2),
    detail: (s) => `${Math.round(s.totalCardioMeters / METERS_PER_MILE)} / 26 mi`,
  },
  {
    key: 'cardio-century',
    label: 'Century Rider',
    caption: 'Log 100 miles of cardio.',
    icon: '🚴',
    group: 'Cardio',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE * 100),
    detail: (s) => `${Math.round(s.totalCardioMeters / METERS_PER_MILE)} / 100 mi`,
  },
  {
    key: 'cardio-500mi',
    label: 'Long Hauler',
    caption: 'Log 500 miles of cardio.',
    icon: '🗺️',
    group: 'Cardio',
    progress: (s) => ratio(s.totalCardioMeters, METERS_PER_MILE * 500),
    detail: (s) => `${Math.round(s.totalCardioMeters / METERS_PER_MILE)} / 500 mi`,
  },
  {
    key: 'cardio-10h',
    label: 'Ten Hours In',
    caption: 'Log 10 hours of cardio.',
    icon: '⏱️',
    group: 'Cardio',
    progress: (s) => ratio(s.totalCardioSeconds, 10 * 3600),
    detail: (s) => `${Math.floor(s.totalCardioSeconds / 3600)} / 10 hrs`,
  },
  {
    key: 'cardio-50h',
    label: 'Endurance Engine',
    caption: 'Log 50 hours of cardio.',
    icon: '🫀',
    group: 'Cardio',
    progress: (s) => ratio(s.totalCardioSeconds, 50 * 3600),
    detail: (s) => `${Math.floor(s.totalCardioSeconds / 3600)} / 50 hrs`,
  },
]

export interface BadgeState extends Badge {
  earned: boolean
  fraction: number
  /** `detail(stats)` resolved against the current stats, ready to render. */
  detailText: string
}

/** Evaluate every badge against the stats. Earned first, then nearest-to-earn. */
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

/**
 * The badges worth surfacing on Home: earned ones, plus unearned ones the user
 * has *started* (fraction > 0). Untouched badges are hidden here — showing every
 * locked target is noise; the full catalog lives on the More screen. Falls back
 * to the single closest badge so Home is never empty for a new user.
 */
export function homeBadges(all: BadgeState[]): BadgeState[] {
  const inPlay = all.filter((b) => b.earned || b.fraction > 0)
  if (inPlay.length > 0) return inPlay
  const next = all.find((b) => !b.earned)
  return next ? [next] : []
}

/** The full catalog grouped into sections, for the More > Badges screen. */
export function groupedBadges(
  all: BadgeState[],
): { group: BadgeGroup; badges: BadgeState[] }[] {
  const order: BadgeGroup[] = [
    'Milestones',
    'Consistency',
    'Strength',
    'Volume',
    'Cardio',
  ]
  return order
    .map((group) => ({ group, badges: all.filter((b) => b.group === group) }))
    .filter((section) => section.badges.length > 0)
}
