import { trendChangePerWeek, weightTrend, type BodyWeight } from '@tracker-engine/body'
import type { Goal, Program } from '@/domain/types'

/**
 * Measures energy expenditure from weight trend and logged intake, instead of predicting it
 * from a formula.
 *
 * The whole point: a formula tells you what an average person of your size burns, while this
 * tells you what *you* burned, including training, fidgeting and adaptation. So a connected
 * fitness app must never add "calories burned" on top — that expenditure is already in this
 * number, and crediting it twice is the single easiest way to make the app wrong.
 */

/**
 * kcal per kg of bodyweight change. The folk 7700 figure is fat-only; tissue gained in a
 * surplus is partly lean, which is far cheaper per kg, so using 7700 throughout would
 * systematically overstate a bulk's surplus.
 */
export const KCAL_PER_KG_FAT = 7700
export const KCAL_PER_KG_LEAN = 1800

/**
 * The energy density to price a trend change at. Faster gain deposits proportionally more
 * fat, so it approaches the fat figure; slow gain is leaner.
 */
export function kcalPerKg(goal: Goal, ratePctPerWeek: number): number {
  if (goal !== 'gain') return KCAL_PER_KG_FAT
  const leanFraction = Math.max(0, Math.min(0.6, 0.6 - Math.abs(ratePctPerWeek)))
  return KCAL_PER_KG_LEAN * leanFraction + KCAL_PER_KG_FAT * (1 - leanFraction)
}

export interface IntakeDay {
  day: string
  kcal: number
}

export interface ExpenditureWindow {
  weekStart: string
  meanIntakeKcal: number
  daysLogged: number
  trendKg: number
  trendChangeKgPerWeek: number
  /** The window's own estimate, before filtering. */
  estimateKcal: number
  /** Higher when fewer days were logged or the scale was noisy. */
  variance: number
}

export interface ExpenditureState {
  /** Filtered expenditure, kcal/day. */
  kcal: number
  /** Standard error. Never present the estimate without it. */
  se: number
}

const MIN_DAYS_LOGGED = 4
const MIN_WEIGH_INS = 3
/** Cap on how far a target may move week to week, so a noisy week can't whipsaw the user. */
export const MAX_TARGET_STEP_KCAL = 150

/**
 * One window's raw estimate: intake minus the energy the trend says was banked or spent.
 *
 * `TDEE = mean_intake − ΔE / days`
 */
export function windowEstimate(
  weekStart: string,
  intake: readonly IntakeDay[],
  weights: readonly BodyWeight[],
  energyPerKg: number,
): ExpenditureWindow | null {
  const logged = intake.filter((d) => d.kcal > 0)
  const trend = weightTrend(weights)
  if (logged.length < MIN_DAYS_LOGGED || trend.length < MIN_WEIGH_INS) return null

  const meanIntakeKcal = logged.reduce((a, d) => a + d.kcal, 0) / logged.length
  const changePerWeek = trendChangePerWeek(trend) ?? 0
  const estimateKcal = meanIntakeKcal - (changePerWeek * energyPerKg) / 7

  // Trust the window less when days are missing, and less again when the scale readings
  // scatter — both make the trend a weaker claim about the same underlying number.
  const coverage = logged.length / 7
  const spread = standardDeviation(trend.map((p) => p.kg - p.trendKg))
  const variance = (2500 / coverage) * (1 + spread)

  return {
    weekStart,
    meanIntakeKcal,
    daysLogged: logged.length,
    trendKg: trend[trend.length - 1]!.trendKg,
    trendChangeKgPerWeek: changePerWeek,
    estimateKcal,
    variance,
  }
}

/**
 * Folds successive window estimates into one figure, Kalman-style.
 *
 * A single week is far too noisy to act on — water weight alone can swing an estimate by
 * hundreds of kcal — so each window nudges the running state in proportion to how much it
 * can be trusted. Without this the targets would oscillate every check-in and the user would
 * rightly stop believing them.
 */
export function filterExpenditure(
  windows: readonly ExpenditureWindow[],
  prior: ExpenditureState | null,
): ExpenditureState | null {
  if (windows.length === 0) return prior
  // A weak prior when there's none: wide enough that the first real window dominates.
  let mean = prior?.kcal ?? windows[0]!.estimateKcal
  let variance = prior ? prior.se ** 2 : 250_000

  for (const window of windows) {
    // Expenditure genuinely drifts (adaptation, activity, mass change), so let uncertainty
    // grow between windows rather than converging on a stale value forever.
    variance += 400
    const gain = variance / (variance + window.variance)
    mean += gain * (window.estimateKcal - mean)
    variance *= 1 - gain
  }

  return { kcal: Math.round(mean), se: Math.round(Math.sqrt(variance)) }
}

/** Target calories for the program's goal rate, given measured expenditure. */
export function targetKcal(
  expenditure: ExpenditureState,
  program: Pick<Program, 'goal' | 'ratePctPerWeek'>,
  trendKg: number,
): number {
  if (program.goal === 'maintain') return expenditure.kcal
  const kgPerWeek = (program.ratePctPerWeek / 100) * trendKg
  const dailyDelta = (kgPerWeek * kcalPerKg(program.goal, program.ratePctPerWeek)) / 7
  return Math.round(expenditure.kcal + dailyDelta)
}

/** Clamps movement so one noisy week can't whipsaw the target. */
export function stepToward(current: number, proposed: number): number {
  const delta = proposed - current
  if (Math.abs(delta) <= MAX_TARGET_STEP_KCAL) return proposed
  return current + Math.sign(delta) * MAX_TARGET_STEP_KCAL
}

/**
 * Cold-start expenditure: Mifflin–St Jeor times an activity factor.
 *
 * A prior the data overwrites, not an answer — the first fortnight is explicitly low
 * confidence. If REPutation is connected, `sessionsPerWeek` comes from measured training
 * rather than asking the user to rate their own activity, which people do badly.
 */
export function estimateInitialExpenditure(input: {
  kg: number
  heightCm: number
  age: number
  sex: 'male' | 'female'
  sessionsPerWeek: number
}): ExpenditureState {
  const bmr =
    10 * input.kg +
    6.25 * input.heightCm -
    5 * input.age +
    (input.sex === 'male' ? 5 : -161)
  const factor = 1.2 + Math.min(6, Math.max(0, input.sessionsPerWeek)) * 0.055
  // A wide error bar, because this is a population average standing in for one person.
  return { kcal: Math.round(bmr * factor), se: 350 }
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}
