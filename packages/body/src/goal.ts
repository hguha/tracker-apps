import { DAY_MS, WEEK_MS, dayNoon } from '@tracker-engine/core'
import type { TrendPoint } from './weight'

export type Goal = 'lose' | 'gain' | 'maintain'

export interface GoalProgress {
  fraction: number | null
  remainingKg: number
  isReached: boolean
}

export function goalProgress(inputs: {
  goal: Goal
  targetKg: number
  startKg: number | null
  trendKg: number
}): GoalProgress {
  const { goal, targetKg, startKg, trendKg } = inputs
  const isReached =
    goal === 'lose' ? trendKg <= targetKg : goal === 'gain' ? trendKg >= targetKg : false

  const fraction =
    startKg === null || startKg === targetKg
      ? null
      : Math.max(0, Math.min(1, (startKg - trendKg) / (startKg - targetKg)))

  return { fraction, remainingKg: trendKg - targetKg, isReached }
}

export const FLAT_KG_PER_WEEK = 0.05
const HELD_KG = 0.05
const SCALE_WINDOW_DAYS = 28
const MIN_WEIGH_INS = 3
const MIN_SCALE_SPAN_DAYS = 3
const DAILY_WEIGHT_NOISE_KG = 0.5
const WATER_WEIGHT_PERSISTENCE = 1.5
const MAX_ETA_WEEKS = 260

export interface RateEstimate {
  kgPerWeek: number
  se: number
}

export interface ScaleRate extends RateEstimate {
  weighIns: number
  spanDays: number
}

export function scaleRate(
  trend: readonly TrendPoint[],
  now: number,
  behaviourSince: number | null = null,
): ScaleRate | null {
  const since = Math.max(now - SCALE_WINDOW_DAYS * DAY_MS, behaviourSince ?? 0)
  const points = trend
    .filter((point) => dayNoon(point.day) >= since)
    .map((point) => ({ x: dayNoon(point.day) / DAY_MS, kg: point.kg }))
  if (points.length < MIN_WEIGH_INS) return null

  const first = points[0]!.x
  const spanDays = points[points.length - 1]!.x - first
  if (spanDays < MIN_SCALE_SPAN_DAYS) return null

  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length
  const meanKg = points.reduce((sum, p) => sum + p.kg, 0) / points.length
  const sxx = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0)
  const slope = points.reduce((sum, p) => sum + (p.x - meanX) * (p.kg - meanKg), 0) / sxx

  const residualSq = points.reduce(
    (sum, p) => sum + (p.kg - (meanKg + slope * (p.x - meanX))) ** 2,
    0,
  )
  const residualSd = points.length > 2 ? Math.sqrt(residualSq / (points.length - 2)) : 0
  const noise = Math.max(DAILY_WEIGHT_NOISE_KG, residualSd)

  return {
    kgPerWeek: slope * 7,
    se: (noise / Math.sqrt(sxx)) * 7 * WATER_WEIGHT_PERSISTENCE,
    weighIns: points.length,
    spanDays: Math.round(spanDays),
  }
}

export function etaAt(neededKg: number, kgPerWeek: number, now: number): number | null {
  if (neededKg === 0 || Math.abs(kgPerWeek) < FLAT_KG_PER_WEEK) return null
  if (Math.sign(kgPerWeek) !== Math.sign(neededKg)) return null
  const weeks = neededKg / kgPerWeek
  return weeks > MAX_ETA_WEEKS ? null : now + weeks * WEEK_MS
}

export interface ScaleOutlook {
  goal: Goal
  progress: GoalProgress
  rate: ScaleRate | null
  isWrongWay: boolean
  likelyAt: number | null
  earliestAt: number | null
  latestAt: number | null
}

const goalDirection = (fromKg: number, targetKg: number): Goal =>
  targetKg < fromKg ? 'lose' : targetKg > fromKg ? 'gain' : 'maintain'

export function scaleOutlook(inputs: {
  targetKg: number
  startKg: number | null
  trend: readonly TrendPoint[]
  now: number
}): ScaleOutlook | null {
  const { targetKg, startKg, trend, now } = inputs
  const latest = trend[trend.length - 1]
  if (!latest) return null
  const goal = goalDirection(startKg ?? latest.trendKg, targetKg)
  const measured = goalProgress({ goal, targetKg, startKg, trendKg: latest.trendKg })
  const progress =
    goal === 'maintain'
      ? { ...measured, isReached: Math.abs(measured.remainingKg) < HELD_KG }
      : measured
  const rate = scaleRate(trend, now)
  const neededKg = targetKg - latest.trendKg
  const toward = Math.sign(neededKg)
  const isMoving = rate !== null && Math.abs(rate.kgPerWeek) >= FLAT_KG_PER_WEEK
  const isWrongWay =
    !progress.isReached && isMoving && toward !== 0 && Math.sign(rate.kgPerWeek) === -toward
  const forecastAt = (kgPerWeek: number) =>
    progress.isReached || isWrongWay ? null : etaAt(neededKg, kgPerWeek, now)
  return {
    goal,
    progress,
    rate,
    isWrongWay,
    likelyAt: rate && forecastAt(rate.kgPerWeek),
    earliestAt: rate && forecastAt(rate.kgPerWeek + toward * rate.se),
    latestAt: rate && forecastAt(rate.kgPerWeek - toward * rate.se),
  }
}
