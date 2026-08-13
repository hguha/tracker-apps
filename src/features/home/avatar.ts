// Per-region avatar fitness (§5.2.1) = workFactor × freshnessFactor, clamped 0–1.
// Freshness decays over days, so a neglected region deflates within days.

import type { Region } from '@/domain/types'
import { REGIONS } from '@/domain/types'

export const WINDOW_DAYS = 14

/** Sets counting as "fully trained" — ~2 sessions × 6 sets a fortnight, a maintenance dose. */
const TARGET_SETS = 12

/** Days of neglect until a region fully deflates — tuned for visible decay by ~10 days. */
const DECAY_DAYS = 10

export const AVATAR_REGIONS: Region[] = [...REGIONS]

export interface RegionInput {
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

function workFactor(setsInWindow: number): number {
  return Math.min(1, setsInWindow / TARGET_SETS)
}

function freshnessFactor(daysSinceTrained: number | null): number {
  if (daysSinceTrained === null) return 0
  return Math.max(0, 1 - daysSinceTrained / DECAY_DAYS)
}

export function regionFitness(input: RegionInput): number {
  const raw = workFactor(input.setsInWindow) * freshnessFactor(input.daysSinceTrained)
  return Math.min(1, Math.max(0, raw))
}

export function fitnessLevel(fitness: number): number {
  if (fitness <= 0.05) return 0
  if (fitness < 0.4) return 1
  if (fitness < 0.75) return 2
  return 3
}

/** Cardio is included — the renderer shows it as an aura, not a limb. */
export function evaluateAvatar(inputs: Map<Region, RegionInput>): RegionFitness[] {
  return AVATAR_REGIONS.map((region) => {
    const input = inputs.get(region) ?? { setsInWindow: 0, daysSinceTrained: null }
    const fitness = regionFitness(input)
    return { region, fitness, level: fitnessLevel(fitness) }
  })
}

/** Average across muscle regions only — cardio is the aura, not the body. */
export function overallCondition(fitnesses: RegionFitness[]): number {
  const muscles = fitnesses.filter((f) => f.region !== 'cardio')
  if (muscles.length === 0) return 0
  return muscles.reduce((sum, f) => sum + f.fitness, 0) / muscles.length
}

export function conditionLabel(overall: number): string {
  if (overall <= 0.05) return 'Out of shape'
  if (overall < 0.35) return 'Getting started'
  if (overall < 0.6) return 'Coming along'
  if (overall < 0.85) return 'In good shape'
  return 'Peak shape'
}
