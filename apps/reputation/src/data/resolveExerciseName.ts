/**
 * Resolves a written exercise name to (movement, equipment).
 *
 * The AI coach answers with free text — "Cable Face Pull", "Leg Press", "Push-up"
 * — but the app stores a movement id plus a separately-chosen equipment. Nothing
 * used to bridge that: the coach path matched the name to an id and stamped every
 * exercise `barbell`, so a cable movement became "Barbell Face Pull" and its
 * records landed in a phantom `face_pull:barbell` bucket.
 *
 * Every signal needed already existed and none of it was consulted:
 *   - `VARIANT_MAPPINGS` maps a variant slug to exactly {baseId, equipment}
 *   - the equipment word is right there in the name
 *   - a movement with only one known equipment has no ambiguity to resolve
 *   - tracking type fixes the implement for bodyweight/assisted/cardio
 *
 * This is the one place that combines them, so the picker, the coach, and the
 * migration can't disagree about what "Cable Fly" means.
 */

import { RETIRED_BASE_IDS, slugify, VARIANT_MAPPINGS } from '@/db/seed/bases'
import { splitEquipment } from '@/domain/movement'
import {
  defaultEquipmentForTracking,
  equipmentIsChosen,
  type Equipment,
  type Exercise,
} from '@/domain/types'

/** Which signal decided the equipment, for logging and tests. */
export type Confidence =
  | 'hint'
  | 'tracking'
  | 'variant-mapping'
  | 'name-token'
  | 'sole-variant'
  | 'last-used'
  | 'fallback'

export interface NameResolution {
  exerciseId: string
  equipment: Equipment
  confidence: Confidence
}

export type ExerciseResolver = (
  name: string,
  hint?: Equipment | null,
) => NameResolution | null

// oldVariantSlug -> {baseId, equipment}, e.g. cable_face_pull -> face_pull + cable.
const VARIANT_BY_SLUG = new Map(VARIANT_MAPPINGS.map((m) => [m.oldId, m]))

// baseId -> the distinct equipment its variants were seeded with. A single entry
// means the movement is only ever done one way, so there is nothing to guess.
const EQUIPMENT_BY_BASE = new Map<string, Set<Equipment>>()
for (const mapping of VARIANT_MAPPINGS) {
  const set = EQUIPMENT_BY_BASE.get(mapping.baseId) ?? new Set<Equipment>()
  set.add(mapping.equipment)
  EQUIPMENT_BY_BASE.set(mapping.baseId, set)
}

function soleEquipmentFor(baseId: string): Equipment | null {
  const options = EQUIPMENT_BY_BASE.get(baseId)
  if (!options || options.size !== 1) return null
  return [...options][0]!
}

/**
 * Builds a resolver over a library snapshot.
 *
 * @param library  the user's visible exercises (`listExercises()`).
 * @param lastUsed equipment the user last logged per exercise id, preferred over
 *                 a bare default so a plan matches how they actually train.
 */
export function buildExerciseResolver(
  library: Exercise[],
  lastUsed?: Map<string, Equipment>,
): ExerciseResolver {
  const byId = new Map(library.map((e) => [e.id, e]))
  const byName = new Map<string, string>()
  // Names first, then aliases, so an alias can never shadow a real name.
  for (const exercise of library) byName.set(exercise.name.toLowerCase(), exercise.id)
  for (const exercise of library) {
    for (const alias of exercise.aliases) {
      const key = alias.toLowerCase()
      if (!byName.has(key)) byName.set(key, exercise.id)
    }
  }

  // An unambiguous hit: the label names this movement, by name, alias, id, or a
  // retired form of one.
  function findExact(label: string): string | null {
    const normalized = label.trim().toLowerCase()
    if (normalized === '') return null

    const byExactName = byName.get(normalized)
    if (byExactName !== undefined) return byExactName

    const slug = slugify(normalized)
    if (byId.has(slug)) return slug
    // An id retired by a rename ('curl' -> 'biceps_curl').
    const renamed = RETIRED_BASE_IDS[slug]
    if (renamed !== undefined && byId.has(renamed)) return renamed

    const variant = VARIANT_BY_SLUG.get(slug)
    if (variant && byId.has(variant.baseId)) return variant.baseId

    return null
  }

  // Last resort only. Ranked the way the picker's search ranks — prefix beats
  // substring beats alias — so a near-miss lands where a person would put it.
  function findFuzzy(label: string): string | null {
    const normalized = label.trim().toLowerCase()
    if (normalized === '') return null

    let best: { id: string; score: number; name: string } | null = null
    for (const exercise of library) {
      const name = exercise.name.toLowerCase()
      let score = -1
      if (name.startsWith(normalized)) score = 0
      else if (name.includes(normalized)) score = 1
      else if (normalized.includes(name)) score = 2
      else if (exercise.aliases.some((a) => a.toLowerCase().includes(normalized)))
        score = 3
      if (score < 0) continue
      if (
        best === null ||
        score < best.score ||
        (score === best.score && exercise.name < best.name)
      ) {
        best = { id: exercise.id, score, name: exercise.name }
      }
    }
    return best?.id ?? null
  }

  return (name, hint) => {
    const written = name.trim()
    if (written === '') return null

    const slug = slugify(written)
    const mapping = VARIANT_BY_SLUG.get(slug)
    const token = splitEquipment(written)

    // Exact matches on both the written name and its equipment-stripped form come
    // first; only then guess. Otherwise "Cable Fly" fuzzy-matches "Incline Fly"
    // (whose alias contains it) instead of resolving cleanly to Chest Fly.
    const stripped = token.equipment !== null ? token.movement : null
    const exerciseId =
      findExact(written) ??
      (stripped !== null ? findExact(stripped) : null) ??
      (mapping && byId.has(mapping.baseId) ? mapping.baseId : null) ??
      findFuzzy(written) ??
      (stripped !== null ? findFuzzy(stripped) : null)
    if (exerciseId === null) return null

    const exercise = byId.get(exerciseId)
    if (!exercise) return null

    // Bodyweight, assisted and cardio movements have no equipment choice, and this
    // must outrank every other signal: the picker stamps exactly this value, so
    // disagreeing here would split one movement's records across two buckets.
    if (!equipmentIsChosen(exercise.trackingType)) {
      return {
        exerciseId,
        equipment: defaultEquipmentForTracking(exercise.trackingType),
        confidence: 'tracking',
      }
    }

    if (hint) return { exerciseId, equipment: hint, confidence: 'hint' }

    if (mapping && mapping.baseId === exerciseId) {
      return { exerciseId, equipment: mapping.equipment, confidence: 'variant-mapping' }
    }
    if (token.equipment !== null) {
      return { exerciseId, equipment: token.equipment, confidence: 'name-token' }
    }
    const sole = soleEquipmentFor(exerciseId)
    if (sole !== null) return { exerciseId, equipment: sole, confidence: 'sole-variant' }

    const previous = lastUsed?.get(exerciseId)
    if (previous !== undefined) {
      return { exerciseId, equipment: previous, confidence: 'last-used' }
    }
    return { exerciseId, equipment: 'barbell', confidence: 'fallback' }
  }
}
