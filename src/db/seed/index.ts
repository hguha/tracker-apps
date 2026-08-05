/**
 * Populates the system library on first run.
 *
 * Idempotent and additive: it only inserts rows that are missing, so it can run
 * on every launch and can add new library entries in a later version without
 * touching anything the user has edited.
 */

import { db, syncStamp } from '@/db/database'
import type { Exercise, MetricDefinition, Muscle, Profile } from '@/domain/types'
import { EXERCISE_SEEDS } from './exercises'
import { METRIC_SEEDS } from './metrics'
import { MUSCLE_SEEDS } from './muscles'

/**
 * Single-user local prototype, so the owner id is a constant. When Supabase
 * auth lands this becomes the authenticated user's id and nothing else changes.
 */
export const LOCAL_USER_ID = 'local-user'

/** Stable id from a name, so re-seeding never duplicates an exercise. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Guards against concurrent runs. React StrictMode double-invokes effects, so
 * without this both calls see empty tables and both try to insert the library,
 * and the second one fails on a primary-key conflict.
 */
let inFlight: Promise<void> | null = null

export function seedIfNeeded(): Promise<void> {
  inFlight ??= runSeed().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runSeed(): Promise<void> {
  await seedProfile()
  await seedMuscles()
  await seedExercises()
  await seedMetricDefinitions()
}

async function seedProfile(): Promise<void> {
  const existing = await db.profiles.get(LOCAL_USER_ID)
  if (existing) return

  const profile: Profile = {
    id: LOCAL_USER_ID,
    displayName: 'You',
    unitWeight: 'lb',
    unitDistance: 'mi',
    unitLength: 'in',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekStartsOn: 1,
    defaultRestSeconds: 60,
    showRpe: false,
    bodyweightCacheKg: null,
    theme: 'default',
    colorScheme: 'system',
    accentOverride: null,
    soundEnabled: true,
    autoStartRest: false,
    ...syncStamp(),
  }
  // `put` rather than `add` so a concurrent seed can't collide on the key.
  await db.profiles.put(profile)
}

async function seedMuscles(): Promise<void> {
  const existingIds = new Set(await db.muscles.toCollection().primaryKeys())
  const missing: Muscle[] = MUSCLE_SEEDS.filter((m) => !existingIds.has(m.id)).map(
    (m) => ({
      id: m.id,
      userId: null,
      name: m.name,
      region: m.region,
      isArchived: false,
      ...syncStamp(),
    }),
  )
  if (missing.length > 0) await db.muscles.bulkPut(missing)
}

async function seedExercises(): Promise<void> {
  const existingIds = new Set(await db.exercises.toCollection().primaryKeys())
  const missing: Exercise[] = []

  for (const seed of EXERCISE_SEEDS) {
    const id = slugify(seed.name)
    if (existingIds.has(id)) continue
    missing.push({
      id,
      userId: null,
      name: seed.name,
      primaryMuscleId: seed.primary,
      secondaryMuscles: (seed.secondary ?? []).map(([muscleId, contribution]) => ({
        muscleId,
        contribution,
      })),
      aliases: seed.aliases ?? [],
      equipment: seed.equipment,
      movementPattern: seed.pattern,
      trackingType: seed.tracking ?? 'weight_reps',
      isUnilateral: seed.unilateral ?? false,
      bodyweightFactor: seed.bodyweightFactor ?? null,
      isKeyLift: false,
      notes: '',
      defaultRestSeconds: null,
      isArchived: false,
      ...syncStamp(),
    })
  }

  if (missing.length > 0) await db.exercises.bulkPut(missing)
}

async function seedMetricDefinitions(): Promise<void> {
  const existingIds = new Set(await db.metricDefinitions.toCollection().primaryKeys())
  const missing: MetricDefinition[] = METRIC_SEEDS.filter(
    (m) => !existingIds.has(m.key),
  ).map((m) => ({
    id: m.key,
    userId: null,
    key: m.key,
    label: m.label,
    unitType: m.unitType,
    category: m.category,
    higherIsBetter: m.higherIsBetter,
    aggregation: 'last' as const,
    precision: m.precision,
    ...syncStamp(),
  }))
  if (missing.length > 0) await db.metricDefinitions.bulkPut(missing)
}
