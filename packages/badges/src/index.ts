/**
 * The badge engine, without the badges.
 *
 * Everything app-specific — what the stats are, what counts as a milestone, how a weight or a
 * distance is worded — stays in the app's own catalog. What's shared is the part both apps got
 * wrong in the same way if written twice: progress that must clamp, a NaN stat that must not
 * render as "NaN", and the ordering that puts an almost-earned badge in front of an untouched one.
 */

/**
 * Any stats object. Constrained to `object` rather than `Record<string, number>` so an app can
 * pass a plain interface: adding an index signature just to satisfy the engine would let a typo
 * in a stat name through unnoticed, which is the opposite of what the type is for.
 */
export type Stats = object

export interface Badge<S extends Stats, G extends string = string> {
  key: string
  label: string
  caption: string
  icon: string
  group: G
  /** 0–1; ≥ 1 is earned. */
  progress: (stats: S) => number
  /** The concrete state, e.g. "12 / 25 days". */
  detail: (stats: S) => string
}

export interface BadgeState<S extends Stats, G extends string = string> extends Badge<S, G> {
  earned: boolean
  /** `progress` clamped to 0–1, so a bar can render it directly. */
  fraction: number
  detailText: string
}

/** Guards against a divide-by-zero or a NaN stat poisoning the score. */
export function ratio(current: number, target: number): number {
  if (target <= 0) return 0
  const value = current / target
  return Number.isFinite(value) ? value : 0
}

/**
 * Replaces any non-finite number with 0, key-driven so a new stat can't be forgotten.
 *
 * One NaN — a division by a bodyweight nobody has entered yet — otherwise renders as "NaN / 25"
 * on a tile, which reads as a broken app rather than an unstarted badge.
 */
export function sanitizeStats<S extends Stats>(stats: S): S {
  const out = { ...stats } as Record<string, unknown>
  for (const [key, value] of Object.entries(out)) {
    // `undefined` counts: an old row missing a field arrives that way, and it renders as
    // "NaN / 135 lb" just as readily as a NaN does.
    const isMissingNumber = value === undefined || value === null
    if (isMissingNumber || (typeof value === 'number' && !Number.isFinite(value))) out[key] = 0
  }
  return out as S
}

export function evaluateBadges<S extends Stats, G extends string>(
  badges: readonly Badge<S, G>[],
  rawStats: S,
): BadgeState<S, G>[] {
  const stats = sanitizeStats(rawStats)
  return badges
    .map((badge) => {
      const raw = badge.progress(stats)
      const fraction = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
      return { ...badge, earned: fraction >= 1, fraction, detailText: badge.detail(stats) }
    })
    .sort((a, b) => {
      if (a.earned !== b.earned) return a.earned ? -1 : 1
      // Among unearned, closest to earning comes first — the most motivating order.
      return a.earned ? 0 : b.fraction - a.fraction
    })
}

/**
 * Earned badges plus started ones. An untouched target is noise on a home screen, so it's
 * hidden — except when nothing has been started at all, where the single closest badge stands in
 * so a new user isn't shown an empty shelf.
 */
export function startedBadges<S extends Stats, G extends string>(
  all: readonly BadgeState<S, G>[],
): BadgeState<S, G>[] {
  const inPlay = all.filter((badge) => badge.earned || badge.fraction > 0)
  if (inPlay.length > 0) return inPlay
  const next = all.find((badge) => !badge.earned)
  return next ? [next] : []
}

export function groupBadges<S extends Stats, G extends string>(
  all: readonly BadgeState<S, G>[],
  order: readonly G[],
): { group: G; badges: BadgeState<S, G>[] }[] {
  return order
    .map((group) => ({ group, badges: all.filter((badge) => badge.group === group) }))
    .filter((section) => section.badges.length > 0)
}

/**
 * A "reach this number" badge — the shape most badges have, so the target and the wording can't
 * drift apart.
 */
export function countBadge<S extends Stats, G extends string>(
  key: string,
  label: string,
  caption: string,
  icon: string,
  group: G,
  pick: (stats: S) => number,
  target: number,
  unit = '',
): Badge<S, G> {
  return {
    key,
    label,
    caption,
    icon,
    group,
    progress: (stats) => ratio(pick(stats), target),
    detail: (stats) =>
      `${Math.min(pick(stats), target).toLocaleString()} / ${target.toLocaleString()}${unit}`,
  }
}
