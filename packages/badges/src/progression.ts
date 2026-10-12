export interface Level {
  level: number
  xp: number
  floor: number
  next: number
}

export function levelFor(xp: number): Level {
  let level = 1
  let floor = 0
  while (xp >= floor + level * 100) {
    floor += level * 100
    level += 1
  }
  return { level, xp, floor, next: floor + level * 100 }
}

export interface CelebratedBadge {
  key: string
  label: string
  caption: string
  icon: string
  earned: boolean
}

export interface Celebrated {
  badges: string[]
  level: number
  completedDay: string | null
}

export interface Celebration {
  key: string
  icons: string[]
  title: string
  subtitle: string
}

export function celebrationsSince(
  previous: Celebrated | null,
  now: { badges: readonly CelebratedBadge[]; level: number; day: string; dayComplete: boolean },
): { celebrations: Celebration[]; next: Celebrated } {
  const earned = now.badges.filter((badge) => badge.earned)
  const next: Celebrated = {
    badges: earned.map((badge) => badge.key),
    level: Math.max(now.level, previous?.level ?? 0),
    completedDay: now.dayComplete ? now.day : (previous?.completedDay ?? null),
  }
  if (previous === null) return { celebrations: [], next }

  const celebrations: Celebration[] = []
  const known = new Set(previous.badges)
  const fresh = earned.filter((badge) => !known.has(badge.key))
  if (fresh.length === 1) {
    const [badge] = fresh
    celebrations.push({
      key: `badge:${badge!.key}`,
      icons: [badge!.icon],
      title: badge!.label,
      subtitle: badge!.caption,
    })
  } else if (fresh.length > 1) {
    celebrations.push({
      key: `badges:${fresh.map((badge) => badge.key).join(',')}`,
      icons: fresh.slice(0, 3).map((badge) => badge.icon),
      title: `${fresh.length} badges earned`,
      subtitle: fresh.map((badge) => badge.label).join(' · '),
    })
  }
  if (now.level > previous.level) {
    celebrations.push({
      key: `level:${now.level}`,
      icons: ['⭐'],
      title: `Level ${now.level}`,
      subtitle: 'Earned by showing up.',
    })
  }
  if (now.dayComplete && previous.completedDay !== now.day) {
    celebrations.push({
      key: `day:${now.day}`,
      icons: ['✅'],
      title: 'Day complete',
      subtitle: 'Every goal for today, done.',
    })
  }
  return { celebrations, next }
}

export function nextBadges<B extends { earned: boolean; fraction: number }>(
  all: readonly B[],
  count: number,
): B[] {
  return all
    .filter((badge) => !badge.earned)
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, count)
}
