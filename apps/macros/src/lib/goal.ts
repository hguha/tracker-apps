import { DAY_MS, WEEK_MS, dayNoon } from '@tracker-engine/core'
import type { TrendPoint } from '@tracker-engine/body'
import type { Goal } from '@/domain/types'
import type { ExpenditureState, IntakeDay } from '@/lib/expenditure'

interface GoalProgress {
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
export const SCALE_WINDOW_DAYS = 28
export const EATING_WINDOW_DAYS = 14
export const MIN_EATING_DAYS = 3
const MIN_WEIGH_INS = 3
const MIN_SCALE_SPAN_DAYS = 3
const DAILY_WEIGHT_NOISE_KG = 0.5
const WATER_WEIGHT_PERSISTENCE = 1.5
const LOGGING_SLOP_KCAL = 100
const MAX_ETA_WEEKS = 260
const PACE_TOLERANCE_PCT = 0.125

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

export interface EatingRate extends RateEstimate {
  meanIntakeKcal: number
  days: number
}

export function eatingRate(inputs: {
  intake: readonly IntakeDay[]
  expenditure: ExpenditureState | null
  energyPerKg: number
}): EatingRate | null {
  const { expenditure, energyPerKg } = inputs
  const logged = inputs.intake.filter((day) => day.kcal > 0)
  if (!expenditure || logged.length < MIN_EATING_DAYS) return null

  const mean = logged.reduce((sum, day) => sum + day.kcal, 0) / logged.length
  const variance =
    logged.reduce((sum, day) => sum + (day.kcal - mean) ** 2, 0) / Math.max(1, logged.length - 1)
  const intakeSe = Math.sqrt(variance / logged.length + LOGGING_SLOP_KCAL ** 2)
  const kgPerKcalWeek = 7 / energyPerKg

  return {
    kgPerWeek: (mean - expenditure.kcal) * kgPerKcalWeek,
    se: Math.sqrt(expenditure.se ** 2 + intakeSe ** 2) * kgPerKcalWeek,
    meanIntakeKcal: Math.round(mean),
    days: logged.length,
  }
}

export function blendRates(
  scale: RateEstimate | null,
  eating: RateEstimate | null,
): (RateEstimate & { scaleWeight: number }) | null {
  if (!scale && !eating) return null
  if (!eating) return { ...scale!, scaleWeight: 1 }
  if (!scale) return { ...eating, scaleWeight: 0 }

  const scalePrecision = 1 / scale.se ** 2
  const eatingPrecision = 1 / eating.se ** 2
  const total = scalePrecision + eatingPrecision
  const scaleWeight = scalePrecision / total
  return {
    kgPerWeek: scale.kgPerWeek * scaleWeight + eating.kgPerWeek * (1 - scaleWeight),
    se: Math.sqrt(1 / total),
    scaleWeight,
  }
}

export function etaAt(neededKg: number, kgPerWeek: number, now: number): number | null {
  if (neededKg === 0 || Math.abs(kgPerWeek) < FLAT_KG_PER_WEEK) return null
  if (Math.sign(kgPerWeek) !== Math.sign(neededKg)) return null
  const weeks = neededKg / kgPerWeek
  return weeks > MAX_ETA_WEEKS ? null : now + weeks * WEEK_MS
}

export function rateForKcal(
  dailyKcal: number,
  expenditure: ExpenditureState | null,
  energyPerKg: number,
): number | null {
  return expenditure ? ((dailyKcal - expenditure.kcal) * 7) / energyPerKg : null
}

export type Confidence = 'low' | 'medium' | 'high'
export type PaceCheck = 'matches' | 'custom' | 'off-pace'

export interface RateLine {
  kgPerWeek: number
  etaAt: number | null
}

export interface LikelyLine extends RateLine {
  se: number
  earliestAt: number | null
  latestAt: number | null
  scaleWeight: number
  confidence: Confidence
}

export interface GoalForecast {
  neededKg: number
  likely: LikelyLine | null
  eating: EatingRate | null
  scale: ScaleRate | null
  onTarget: (RateLine & { targetKcal: number }) | null
  chosen: RateLine
  expenditureKcal: number | null
  pace: PaceCheck
  isWrongWay: boolean
}

export function goalForecast(inputs: {
  goal: Goal
  targetKg: number
  trend: readonly TrendPoint[]
  intake: readonly IntakeDay[]
  expenditure: ExpenditureState | null
  energyPerKg: number
  targetKcal: number | null
  isCustomTarget: boolean
  ratePctPerWeek: number
  behaviourSince?: number | null
  now: number
}): GoalForecast | null {
  const latest = inputs.trend[inputs.trend.length - 1]
  if (!latest) return null
  const { now, expenditure, energyPerKg } = inputs
  const neededKg = inputs.targetKg - latest.trendKg

  const scale = scaleRate(inputs.trend, now, inputs.behaviourSince ?? null)
  const eating = eatingRate({ intake: inputs.intake, expenditure, energyPerKg })
  const blended = blendRates(scale, eating)
  const likely = blended === null ? null : likelyLine(blended, neededKg, now)

  const onTargetRate =
    inputs.targetKcal === null ? null : rateForKcal(inputs.targetKcal, expenditure, energyPerKg)
  const onTarget =
    onTargetRate === null || inputs.targetKcal === null
      ? null
      : {
          kgPerWeek: onTargetRate,
          etaAt: etaAt(neededKg, onTargetRate, now),
          targetKcal: inputs.targetKcal,
        }

  const chosenRate = (inputs.ratePctPerWeek / 100) * latest.trendKg

  return {
    neededKg,
    likely,
    eating,
    scale,
    onTarget,
    chosen: { kgPerWeek: chosenRate, etaAt: etaAt(neededKg, chosenRate, now) },
    expenditureKcal: expenditure?.kcal ?? null,
    pace: paceCheck({
      isCustomTarget: inputs.isCustomTarget,
      goal: inputs.goal,
      onTargetRate,
      chosenRate,
      trendKg: latest.trendKg,
    }),
    isWrongWay:
      likely !== null &&
      Math.abs(likely.kgPerWeek) >= FLAT_KG_PER_WEEK &&
      neededKg !== 0 &&
      Math.sign(likely.kgPerWeek) !== Math.sign(neededKg),
  }
}

function likelyLine(
  blended: RateEstimate & { scaleWeight: number },
  neededKg: number,
  now: number,
): LikelyLine {
  const toward = Math.sign(neededKg) || 1
  const relative = blended.se / Math.max(Math.abs(blended.kgPerWeek), FLAT_KG_PER_WEEK)
  return {
    kgPerWeek: blended.kgPerWeek,
    se: blended.se,
    etaAt: etaAt(neededKg, blended.kgPerWeek, now),
    earliestAt: etaAt(neededKg, blended.kgPerWeek + toward * blended.se, now),
    latestAt: etaAt(neededKg, blended.kgPerWeek - toward * blended.se, now),
    scaleWeight: blended.scaleWeight,
    confidence: relative < 0.25 ? 'high' : relative < 0.6 ? 'medium' : 'low',
  }
}

function paceCheck(inputs: {
  isCustomTarget: boolean
  goal: Goal
  onTargetRate: number | null
  chosenRate: number
  trendKg: number
}): PaceCheck {
  if (inputs.isCustomTarget) return 'custom'
  if (inputs.onTargetRate === null) return 'matches'
  const gapPct = (Math.abs(inputs.onTargetRate - inputs.chosenRate) / inputs.trendKg) * 100
  return gapPct > PACE_TOLERANCE_PCT ? 'off-pace' : 'matches'
}
