/**
 * Unit conversion now lives in `@tracker-engine/core` — MACROcosm needs the same arithmetic, and a
 * second copy of "how many pounds in a kilo" is how two apps in one family disagree about a
 * bodyweight. Re-exported here so every existing `@/lib/units` import keeps working.
 *
 * What stays: duration and pace. Both are workout vocabulary, and `formatClock` in particular means
 * something different in MACROcosm (minutes from midnight, not elapsed seconds) — moving it would
 * invite exactly the collision this file exists to avoid.
 */

export {
  LB_PER_KG,
  bodyWeightFromKg,
  convertWeight,
  displayWeight,
  displayWeightOrNull,
  distanceFromM,
  distanceToM,
  formatDisplayWeight,
  formatDistance,
  formatWeight,
  lengthFromCm,
  lengthToCm,
  parseNumber,
  weightFromKg,
  weightToKg,
} from '@tracker-engine/core'

import type { DistanceUnit } from '@/domain/types'
import { distanceFromM } from '@tracker-engine/core'

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatPace(
  durationSeconds: number | null,
  distanceM: number | null,
  unit: DistanceUnit,
): string | null {
  if (!durationSeconds || !distanceM) return null
  const distance = distanceFromM(distanceM, unit)
  if (distance <= 0) return null
  return `${formatDuration(durationSeconds / distance)} / ${unit}`
}
