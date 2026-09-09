import { DAY_MS } from '@tracker-engine/core'
import type { Goal } from '@/domain/types'

/**
 * A goal you can arrive at.
 *
 * The program used to hold only a *direction and a rate* — "lose 0.5% a week" — which is the right
 * input for setting a calorie target and a useless thing to aim at: there is no point at which it is
 * met, so reaching a weight you cared about did nothing at all. A target weight adds the thing a
 * rate can't have, which is an end.
 *
 * The date is computed from the **measured** rate, not the intended one. An ETA from the plan says
 * what would happen if the plan were working; an ETA from the trend says what is actually happening,
 * which is the only version worth putting a date on. When the two disagree that disagreement is the
 * useful information, so both are returned.
 */

export interface GoalProgress {
  /** 0–1 of the way from where the goal was set to the target. Clamped, and null without a start. */
  fraction: number | null
  /** Remaining, in kg. Negative once past the target. */
  remainingKg: number
  /** From the measured trend. Null when the trend is flat or going the wrong way. */
  etaAt: number | null
  /** From the intended rate, for comparison. Null for a maintain program. */
  plannedEtaAt: number | null
  /** True once the target is met in the direction the goal was set. */
  isReached: boolean
  /** Moving away from the target, measurably. Worth saying plainly rather than showing a blank ETA. */
  isWrongWay: boolean
}

/** Below this the trend is noise, not a direction, and an ETA off it would be fiction. */
const FLAT_KG_PER_WEEK = 0.05

export function goalProgress(inputs: {
  goal: Goal
  targetKg: number
  /** The trend when the goal was set, so progress has something to be a fraction of. */
  startKg: number | null
  trendKg: number
  /** Measured kg/week from the weight trend. Null with too few weigh-ins. */
  ratePerWeek: number | null
  /** Intended %/week of bodyweight, signed. */
  ratePctPerWeek: number
  now?: number
}): GoalProgress {
  const { goal, targetKg, startKg, trendKg, ratePerWeek, ratePctPerWeek } = inputs
  const now = inputs.now ?? Date.now()

  const remainingKg = trendKg - targetKg
  // Which way "done" is. A maintain program has no target to reach, so nothing is ever reached.
  const isReached =
    goal === 'lose' ? trendKg <= targetKg : goal === 'gain' ? trendKg >= targetKg : false

  const fraction =
    startKg === null || startKg === targetKg
      ? null
      : Math.max(0, Math.min(1, (startKg - trendKg) / (startKg - targetKg)))

  const needed = targetKg - trendKg
  const isMoving = ratePerWeek !== null && Math.abs(ratePerWeek) >= FLAT_KG_PER_WEEK
  const isWrongWay = !isReached && isMoving && Math.sign(ratePerWeek) !== Math.sign(needed)

  return {
    fraction,
    remainingKg,
    etaAt: isReached || !isMoving || isWrongWay ? null : now + weeksToMs(needed / ratePerWeek),
    plannedEtaAt: plannedEta(needed, trendKg, ratePctPerWeek, now),
    isReached,
    isWrongWay,
  }
}

/**
 * The plan's own ETA, integrated rather than divided.
 *
 * A percentage-of-bodyweight rate compounds: losing 0.5% a week from 90 kg is 450 g in week one and
 * less every week after, so `needed / (rate × weight)` overstates how fast the last few kilos come
 * off. Stepping it week by week is exact enough and cannot go negative.
 */
function plannedEta(
  needed: number,
  trendKg: number,
  ratePctPerWeek: number,
  now: number,
): number | null {
  if (ratePctPerWeek === 0 || needed === 0) return null
  if (Math.sign(ratePctPerWeek) !== Math.sign(needed)) return null

  let weight = trendKg
  const target = trendKg + needed
  for (let week = 1; week <= 260; week += 1) {
    weight *= 1 + ratePctPerWeek / 100
    if (needed < 0 ? weight <= target : weight >= target) return now + weeksToMs(week)
  }
  // Beyond five years is not a date anybody should be shown.
  return null
}

const weeksToMs = (weeks: number): number => weeks * 7 * DAY_MS
