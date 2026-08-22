import { describe, expect, it } from 'vitest'
import {
  deriveBases,
  BASE_EXERCISES,
  EXERCISE_MERGES,
  VARIANT_MAPPINGS,
} from '@/db/seed/bases'
import { EXERCISE_SEEDS } from '@/db/seed/exercises'

describe('deriveBases', () => {
  const { bases, mappings } = deriveBases(EXERCISE_SEEDS)
  const baseById = new Map(bases.map((b) => [b.id, b]))

  // The equipment each base was seen with, from the migration mapping.
  const equipmentByBase = new Map<string, string[]>()
  for (const m of mappings) {
    equipmentByBase.set(m.baseId, [...(equipmentByBase.get(m.baseId) ?? []), m.equipment])
  }

  it('collapses equipment variants of a lift into one base', () => {
    const bench = bases.find((b) => b.name === 'Bench Press')
    expect(bench).toBeDefined()
    expect(equipmentByBase.get(bench!.id)).toEqual(
      expect.arrayContaining(['barbell', 'dumbbell', 'smith']),
    )
    // Incline is a distinct movement, not a bench-press variant.
    const incline = bases.find((b) => b.name === 'Incline Bench Press')
    expect(incline).toBeDefined()
    expect(incline!.id).not.toBe(bench!.id)
  })

  it('maps every seeded variant to exactly one existing base', () => {
    expect(mappings.length).toBe(EXERCISE_SEEDS.length)
    for (const m of mappings) {
      expect(baseById.has(m.baseId)).toBe(true)
    }
  })

  it('never sees a base with two variants of the same equipment', () => {
    // Otherwise the migration couldn't decide which old row an (exercise,
    // equipment) pair came from. Fix the seed/override, not this test.
    for (const [, equipments] of equipmentByBase) {
      expect(new Set(equipments).size).toBe(equipments.length)
    }
  })

  it('never spans regions or tracking types within a base', () => {
    const byBase = new Map<string, typeof EXERCISE_SEEDS>()
    for (const seed of EXERCISE_SEEDS) {
      const baseId = mappings.find((m) => m.oldId === slug(seed.name))?.baseId
      if (!baseId) continue
      byBase.set(baseId, [...(byBase.get(baseId) ?? []), seed])
    }
    for (const [, variants] of byBase) {
      const regions = new Set(variants.map((v) => v.region))
      const tracking = new Set(variants.map((v) => v.tracking ?? 'weight_reps'))
      expect(regions.size).toBe(1)
      expect(tracking.size).toBe(1)
    }
  })

  it('exposes the same data via the module-level constants', () => {
    expect(BASE_EXERCISES.length).toBe(bases.length)
    expect(VARIANT_MAPPINGS.length).toBe(mappings.length)
  })

  it('no longer derives the merged-away duplicate movements', () => {
    // These collapsed into a canonical base; the seed must not recreate them.
    for (const merge of EXERCISE_MERGES) {
      expect(baseById.has(merge.from)).toBe(false)
      expect(baseById.has(merge.to)).toBe(true)
    }
  })

  it('folds the machine chest/incline/shoulder presses into their canonical base', () => {
    expect(equipmentByBase.get('bench_press')).toEqual(
      expect.arrayContaining(['machine']),
    )
    expect(equipmentByBase.get('incline_bench_press')).toEqual(
      expect.arrayContaining(['machine']),
    )
    expect(equipmentByBase.get('overhead_press')).toEqual(
      expect.arrayContaining(['machine', 'dumbbell']),
    )
  })

  it('has no bodyweight tracking type left but the single bodyweight_reps', () => {
    const retired = bases.filter(
      (b) =>
        b.trackingType === ('weighted_bodyweight' as string) ||
        b.trackingType === ('assisted_bodyweight' as string),
    )
    expect(retired).toEqual([])
  })
})

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}
