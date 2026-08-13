// Derives the equipment-free base library from the per-variant seed.
//
// The seed in exercises.ts lists one row per (movement, equipment) — "Barbell
// Bench Press", "Dumbbell Bench Press". The app's model is now one base exercise
// per movement ("Bench Press") with equipment chosen when it's added to a
// workout. Rather than hand-maintain a second list, we DERIVE the base library
// and the old→(base, equipment) mapping from the variants, so there is still one
// source of truth for the taxonomy.
//
// Every property a base needs (region, tracking type, bodyweight factor)
// is constant across a movement's variants — verified by a test — so the merge is
// lossless. Equipment is not stored on the base at all: any movement can use any
// equipment, and the choice lives on the workout. The variant mapping keeps the
// old row's equipment only so history can be backfilled during migration.

import { type Equipment, type Region, type TrackingType } from '@/domain/types'
import { movementFor } from '@/domain/movement'
import { EXERCISE_SEEDS, type ExerciseSeed } from './exercises'

export interface BaseExercise {
  id: string
  name: string
  region: Region
  aliases: string[]
  trackingType: TrackingType
  bodyweightFactor: number | null
}

export interface VariantMapping {
  // slug of the old per-variant exercise name, e.g. `barbell_bench_press`.
  oldId: string
  // slug of the movement label, e.g. `bench_press`.
  baseId: string
  equipment: Equipment
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

const movementOf = (seed: ExerciseSeed): string => seed.movement ?? movementFor(seed.name)

// Base ids that earlier builds derived from a vaguer label, mapped to the id the
// current seed produces. Migration history, not a naming layer: the seed itself
// carries the clearer names now, and this only exists so history that referenced
// the old id gets repointed once.
export const RETIRED_BASE_IDS: Record<string, string> = {
  curl: 'biceps_curl',
  fly: 'chest_fly',
}

// Builds bases + mapping from an arbitrary variant list, so tests can exercise it
// on fixtures as well as the real seed.
export function deriveBases(seeds: ExerciseSeed[]): {
  bases: BaseExercise[]
  mappings: VariantMapping[]
} {
  const grouped = new Map<string, ExerciseSeed[]>()
  for (const seed of seeds) {
    const label = movementOf(seed)
    const list = grouped.get(label)
    if (list) list.push(seed)
    else grouped.set(label, [seed])
  }

  const bases: BaseExercise[] = []
  const mappings: VariantMapping[] = []

  for (const [label, variants] of grouped) {
    const baseId = slugify(label)
    const first = variants[0]!

    // Fold each variant's own name in as a search alias, so "barbell bench" still
    // lands on the "Bench Press" base after the equipment word is gone.
    const aliases = [
      ...new Set([
        ...variants.flatMap((v) => v.aliases ?? []),
        ...variants
          .map((v) => v.name.toLowerCase())
          .filter((n) => n !== label.toLowerCase()),
      ]),
    ]

    bases.push({
      id: baseId,
      name: label,
      region: first.region,
      aliases,
      trackingType: first.tracking ?? 'weight_reps',
      bodyweightFactor: first.bodyweightFactor ?? null,
    })

    for (const variant of variants) {
      mappings.push({
        oldId: slugify(variant.name),
        baseId,
        equipment: variant.equipment,
      })
    }
  }

  return { bases, mappings }
}

export const BASE_EXERCISES = deriveBases(EXERCISE_SEEDS).bases
export const VARIANT_MAPPINGS = deriveBases(EXERCISE_SEEDS).mappings
