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
  totalCardioMeters: number
  totalCardioSeconds: number
  distinctExercises: number
}

/** Squat + bench + deadlift e1RM — the total the 1000/1200/1500 lb clubs measure. */
export function bigThreeTotalKg(s: LifetimeStats): number {
  return s.bestSquatE1rmKg + s.bestBenchE1rmKg + s.bestDeadliftE1rmKg
}

export type BadgeGroup = 'Milestones' | 'Consistency' | 'Strength' | 'Volume' | 'Cardio'

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
const MILLION_LB_IN_KG = lbToKg(1_000_000)

function ratio(current: number, target: number): number {
  if (target <= 0) return 0
  const r = current / target
  // A NaN stat from bad data must not poison the score.
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

function lbDetail(valueKg: number, targetLb: number): string {
  return `${formatDisplayWeight(valueKg, 'lb', { withUnit: false })} / ${targetLb.toLocaleString()} lb`
}

// Order is the display order for the "next up" pick when several are unearned.
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
    'Volume',
    'Cardio',
  ]
  return order
    .map((group) => ({ group, badges: all.filter((b) => b.group === group) }))
    .filter((section) => section.badges.length > 0)
}
