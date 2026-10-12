import {
  FLAT_KG_PER_WEEK,
  etaAt,
  scaleRate,
  type RateEstimate,
  type ScaleRate,
  type TrendPoint,
} from '@tracker-engine/body'
import type { Goal } from '@/domain/types'
import type { ExpenditureState, IntakeDay } from '@/lib/expenditure'

const MIN_EATING_DAYS = 3
const LOGGING_SLOP_KCAL = 100
const PACE_TOLERANCE_PCT = 0.125
export const EATING_WINDOW_DAYS = 14

interface EatingRate extends RateEstimate {
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

export function rateForKcal(
  dailyKcal: number,
  expenditure: ExpenditureState | null,
  energyPerKg: number,
): number | null {
  return expenditure ? ((dailyKcal - expenditure.kcal) * 7) / energyPerKg : null
}

type Confidence = 'low' | 'medium' | 'high'
const UNSAFE_MARGIN_PCT = 0.01

type PaceCheck = 'matches' | 'custom' | 'off-pace' | 'unsafe'

export interface RateLine {
  kgPerWeek: number
  etaAt: number | null
}

interface LikelyLine extends RateLine {
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
  safeMaxPct: number
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
      isUnsafe: Math.abs(inputs.ratePctPerWeek) > inputs.safeMaxPct + UNSAFE_MARGIN_PCT,
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
  isUnsafe: boolean
  goal: Goal
  onTargetRate: number | null
  chosenRate: number
  trendKg: number
}): PaceCheck {
  if (inputs.isCustomTarget) return 'custom'
  if (inputs.isUnsafe) return 'unsafe'
  if (inputs.onTargetRate === null) return 'matches'
  const gapPct = (Math.abs(inputs.onTargetRate - inputs.chosenRate) / inputs.trendKg) * 100
  return gapPct > PACE_TOLERANCE_PCT ? 'off-pace' : 'matches'
}
