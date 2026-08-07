/**
 * The training avatar's per-region fitness (§5.2.1, gamification).
 *
 * A tamagotchi-style figure: each body region grows "buff" as you train it and
 * visibly deflates when you skip it. This module is the pure, tested engine —
 * it turns recent training into a 0–1 fitness score and a 0–3 visual level per
 * region. The rendering (an abstract body silhouette) reads these; it holds no
 * logic of its own, so the art can change without touching the mechanic.
 *
 * Two forces, multiplied:
 *   - **Work** — how much you've trained the region in a trailing window,
 *     relative to a healthy target. More recent sets → buffer.
 *   - **Freshness** — how recently. This is the decay: it falls off over days,
 *     so a region you haven't touched deflates even if you hammered it a
 *     fortnight ago. Tuned for "classic tamagotchi" — neglect shows within days.
 *
 * `fitness = workFactor × freshnessFactor`, clamped to 0–1.
 */

import type { Region } from '@/domain/types'
import { REGIONS } from '@/domain/types'

/** Days of history the work window looks back over. */
export const WINDOW_DAYS = 14

/** Working sets in the window that count as "fully trained" (level 3) for a
 *  region. ~2 sessions × 6 sets a fortnight is a healthy maintenance dose. */
const TARGET_SETS = 12

/**
 * Days of neglect until a region is fully deflated. Chosen for visible,
 * classic-tamagotchi decay: still healthy a few days out, noticeably shrinking
 * by a week, flat by ~10 days.
 */
const DECAY_DAYS = 10

/** The regions the avatar shows. Every training region has a place on the body. */
export const AVATAR_REGIONS: Region[] = [...REGIONS]

export interface RegionInput {
  /** Working sets logged for this region within WINDOW_DAYS. */
  setsInWindow: number
  /** Days since this region was last trained; null = never. */
  daysSinceTrained: number | null
}

export interface RegionFitness {
  region: Region
  /** 0–1 continuous score, for a smooth fill/scale. */
  fitness: number
  /** 0–3 discrete state, for picking one of four visual sprites. */
  level: number
}

/** How much of the target work the window holds, 0–1. */
function workFactor(setsInWindow: number): number {
  return Math.min(1, setsInWindow / TARGET_SETS)
}

/** How fresh that work is, 0–1. Linear decay to zero at DECAY_DAYS. */
function freshnessFactor(daysSinceTrained: number | null): number {
  if (daysSinceTrained === null) return 0
  return Math.max(0, 1 - daysSinceTrained / DECAY_DAYS)
}

/** Fitness for one region from its recent work. */
export function regionFitness(input: RegionInput): number {
  const raw = workFactor(input.setsInWindow) * freshnessFactor(input.daysSinceTrained)
  return Math.min(1, Math.max(0, raw))
}

/** Map a 0–1 fitness to a 0–3 sprite level. 0 is atrophied; 3 is peak. */
export function fitnessLevel(fitness: number): number {
  if (fitness <= 0.05) return 0
  if (fitness < 0.4) return 1
  if (fitness < 0.75) return 2
  return 3
}

/** Evaluate every region. Cardio is included — the renderer shows it as an aura
 *  rather than a limb, since it isn't a muscle. */
export function evaluateAvatar(inputs: Map<Region, RegionInput>): RegionFitness[] {
  return AVATAR_REGIONS.map((region) => {
    const input = inputs.get(region) ?? { setsInWindow: 0, daysSinceTrained: null }
    const fitness = regionFitness(input)
    return { region, fitness, level: fitnessLevel(fitness) }
  })
}

/** Overall condition, the average across muscle regions (cardio excluded — it's
 *  the aura, not the body). Drives a one-line status like "Peak shape". */
export function overallCondition(fitnesses: RegionFitness[]): number {
  const muscles = fitnesses.filter((f) => f.region !== 'cardio')
  if (muscles.length === 0) return 0
  return muscles.reduce((sum, f) => sum + f.fitness, 0) / muscles.length
}

/** A short, non-nagging status label for the overall condition. */
export function conditionLabel(overall: number): string {
  if (overall <= 0.05) return 'Out of shape'
  if (overall < 0.35) return 'Getting started'
  if (overall < 0.6) return 'Coming along'
  if (overall < 0.85) return 'In good shape'
  return 'Peak shape'
}
