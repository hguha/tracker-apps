import {
  convertWeight,
  dayNoon,
  groupBy,
  signed,
  weekKey,
  weekStart,
  type WeekStart,
  type WeightUnit,
} from '@tracker-engine/core'
import { weightTrend, type BodyWeight } from '@tracker-engine/body'
import {
  estimateInitialExpenditure,
  filterExpenditure,
  kcalPerKg,
  stepToward,
  targetKcal,
  windowEstimate,
  type ExpenditureState,
  type IntakeDay,
} from '@/lib/expenditure'
import { splitTargets } from '@/lib/nutrition'
import type { CheckIn, MacroTargets, Profile, Program } from '@/domain/types'

/**
 * The weekly recalculation: turn a week of weigh-ins and logs into an expenditure estimate
 * and a set of targets.
 *
 * Pure, so the whole loop is testable without a database and identical on the client and in
 * the scheduled edge function — the two must never disagree about what a week concluded.
 */

/** Weeks start Monday, so a weekend of eating lands in the week it belonged to. */
const WEEK_STARTS_ON: WeekStart = 1

export interface CheckInInputs {
  now: number
  program: Program
  profile: Pick<Profile, 'heightCm' | 'birthYear' | 'sex' | 'activity'>
  weights: readonly BodyWeight[]
  /** One entry per logged day; days with nothing logged must be absent, not zero. */
  intake: readonly IntakeDay[]
  /** The most recent check-in, whose expenditure seeds the filter. */
  prior: CheckIn | null
}

type CheckInDraft = Omit<
  CheckIn,
  'id' | 'userId' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'clientRev'
>

export type CheckInOutcome =
  | { kind: 'ready'; draft: CheckInDraft }
  | { kind: 'not-enough-data'; reason: string }

/** Weeks are grouped once here so the estimator and the UI can't disagree about boundaries. */
export function groupByWeek<T>(items: readonly T[], dayOf: (item: T) => string) {
  return groupBy(items, (item) => weekKey(dayNoon(dayOf(item)), WEEK_STARTS_ON))
}

export function currentWeekKey(now: number): string {
  return weekKey(now, WEEK_STARTS_ON)
}

/** The week a `yyyy-MM-dd` day belongs to. Midday, so no timezone can shift the day. */
export function weekKeyForDay(day: string): string {
  return weekKey(dayNoon(day), WEEK_STARTS_ON)
}

/** The week that just ended — the one a check-in is about. */
export function lastCompleteWeekKey(now: number): string {
  return weekKey(weekStart(now, WEEK_STARTS_ON) - 1, WEEK_STARTS_ON)
}

export function buildCheckIn(inputs: CheckInInputs): CheckInOutcome {
  const { program, weights, intake, prior } = inputs
  const week = lastCompleteWeekKey(inputs.now)

  const trend = weightTrend(weights)
  if (trend.length === 0) {
    return { kind: 'not-enough-data', reason: 'Needs at least one weigh-in.' }
  }

  const energyPerKg = kcalPerKg(program.goal, program.ratePctPerWeek)
  // Smoothed once over the whole history, then sliced — see windowEstimate on why per-week
  // smoothing destroys the signal.
  const trendWeeks = groupByWeek(trend, (point) => point.day)
  const intakeWeeks = groupByWeek(intake, (d) => d.day)

  // Every week up to and including the one being checked in, oldest first: the filter needs
  // the sequence, not just the latest window, or it can't distinguish signal from noise.
  const windows = [...new Set([...intakeWeeks.keys(), ...trendWeeks.keys()])]
    .filter((key) => key <= week)
    .sort()
    .map((key) =>
      windowEstimate(key, intakeWeeks.get(key) ?? [], trendWeeks.get(key) ?? [], energyPerKg),
    )
    .filter((w): w is NonNullable<typeof w> => w !== null)

  const priorState: ExpenditureState | null = prior
    ? { kcal: prior.expenditureKcal, se: prior.expenditureSe }
    : coldStart(inputs, trend[trend.length - 1]!.trendKg)

  // The week being checked in must itself qualify. A cold-start prior seeds the filter; it
  // must never stand in as a result, or the app would record a formula's guess as a
  // measurement with `daysLogged: 0` and then treat it as evidence next week.
  const thisWeek = windows.find((w) => w.weekStart === week)
  const expenditure = thisWeek ? filterExpenditure(windows, priorState) : null
  if (!expenditure || !thisWeek) {
    return {
      kind: 'not-enough-data',
      reason: 'Needs a week with at least four days logged and three weigh-ins.',
    }
  }

  const trendKg = thisWeek.trendKg
  const proposed = targetKcal(expenditure, program, trendKg)
  // Move gradually from whatever is in force, so one noisy week can't whipsaw the user.
  const kcal = prior ? stepToward(prior.targets.kcal, proposed) : proposed

  return {
    kind: 'ready',
    draft: {
      weekStart: week,
      expenditureKcal: expenditure.kcal,
      expenditureSe: expenditure.se,
      trendKg,
      trendChangeKgPerWeek: thisWeek.trendChangeKgPerWeek,
      meanIntakeKcal: Math.round(thisWeek.meanIntakeKcal),
      daysLogged: thisWeek.daysLogged,
      kcalPerKg: energyPerKg,
      targets: split(kcal, trendKg, program),
      // Coached applies silently; collaborative waits for a tap; manual never changes a target.
      status: program.coachingMode === 'coached' ? 'applied' : 'proposed',
      note: explain(expenditure, thisWeek.trendChangeKgPerWeek, program),
    },
  }
}

function split(kcal: number, trendKg: number, program: Program): MacroTargets {
  return splitTargets(kcal, trendKg, program.proteinGPerKg, program.fatMinPctKcal)
}

/**
 * A prior for the very first check-in, so week one isn't a coin flip. Deliberately wide, and
 * the data overwrites it within a fortnight.
 */
function coldStart(inputs: CheckInInputs, trendKg: number): ExpenditureState | null {
  const { heightCm, birthYear, sex, activity } = inputs.profile
  if (heightCm === null || birthYear === null || sex === null) return null
  return estimateInitialExpenditure({
    kg: trendKg,
    heightCm,
    age: new Date(inputs.now).getFullYear() - birthYear,
    sex,
    // Null when nobody has been asked yet, which the estimator reads as moderate and a wider
    // error bar — never as a fact about this person.
    activity: activity ?? null,
  })
}

export function describeCheckIn(
  checkIn: Pick<CheckInDraft, 'trendChangeKgPerWeek' | 'expenditureKcal' | 'expenditureSe'>,
  unit: WeightUnit,
): string {
  const rate = checkIn.trendChangeKgPerWeek
  const direction = rate > 0.05 ? 'rising' : rate < -0.05 ? 'falling' : 'flat'
  return `Weight ${direction} at ${signed(convertWeight(rate, unit), 2)} ${unit}/week · burning ${checkIn.expenditureKcal} ± ${checkIn.expenditureSe} kcal/day`
}

/** Why the number moved, in one sentence. A target nobody understands is a target nobody keeps. */
function explain(
  expenditure: ExpenditureState,
  trendChangeKgPerWeek: number,
  program: Program,
): string {
  const direction =
    trendChangeKgPerWeek > 0.05 ? 'rising' : trendChangeKgPerWeek < -0.05 ? 'falling' : 'flat'
  const goalWord =
    program.goal === 'lose' ? 'losing' : program.goal === 'gain' ? 'gaining' : 'holding'
  return `Weight ${direction} at ${signed(trendChangeKgPerWeek, 2)} kg/week; expenditure measured at ${expenditure.kcal} ± ${expenditure.se} kcal/day. Target set for ${goalWord}.`
}

/**
 * The same cold start, from a trend figure already computed.
 *
 * Exists for callers that need it per day: smoothing the whole weight history inside a loop over
 * days is O(days × weigh-ins), which on a year of data is tens of thousands of pointless passes —
 * and every one of them would produce the same trend.
 */
export function initialTargetsFromTrend(
  program: Program,
  profile: Pick<Profile, 'heightCm' | 'birthYear' | 'sex' | 'activity'>,
  trendKg: number,
  now = Date.now(),
): MacroTargets | null {
  const prior = coldStart({ now, program, profile, weights: [], intake: [], prior: null }, trendKg)
  if (!prior) return null
  return split(targetKcal(prior, program, trendKg), trendKg, program)
}
