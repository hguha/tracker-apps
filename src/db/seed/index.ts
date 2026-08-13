// Populates the system library on first run; idempotent and additive, safe to run every launch.

import { db, syncStamp } from '@/db/database'
import { MOVEMENT_PATTERNS } from '@/domain/types'
import type { Exercise, MetricDefinition, Muscle, Profile } from '@/domain/types'
import { patternForRegion } from '@/domain/movement'
import { EXERCISE_SEEDS } from './exercises'
import { METRIC_SEEDS } from './metrics'
import { MUSCLE_SEEDS } from './muscles'

// The offline owner id, replaced with the authenticated UID via setActiveUserId so RLS accepts synced rows.
export const LOCAL_USER_ID = 'local-user'

// The id every write is stamped with; module state, changes only at the signed-out↔signed-in boundary (§11.1.3).
let activeUserId: string = LOCAL_USER_ID

export function setActiveUserId(id: string): void {
  activeUserId = id
}

export function getActiveUserId(): string {
  return activeUserId
}

/** Stable id from a name, so re-seeding never duplicates an exercise. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// Guards against concurrent runs: StrictMode double-invokes effects, and two seeds collide on the primary key.
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
  await repairExerciseRows()
  await repairArmsRegion()
}

// Remaps muscle rows off the retired 'arms' region into 'triceps'/'biceps' (§10.2).
async function repairArmsRegion(): Promise<void> {
  const stale = await db.muscles.filter((m) => (m.region as string) === 'arms').toArray()
  if (stale.length === 0) return
  await db.muscles.bulkPut(
    stale.map((m) => ({
      ...m,
      region: m.id === 'triceps' ? 'triceps' : 'biceps',
    })),
  )
}

// Heals older exercise rows: backfills undefined `aliases`, and remaps any retired
// `movementPattern` value to one derived from the primary muscle.
async function repairExerciseRows(): Promise<void> {
  const muscles = await db.muscles.toArray()
  const regionOf = new Map(muscles.map((m) => [m.id, m.region]))

  const broken = await db.exercises
    .filter(
      (e) =>
        e.aliases === undefined ||
        !(MOVEMENT_PATTERNS as readonly string[]).includes(e.movementPattern),
    )
    .toArray()
  if (broken.length === 0) return

  await db.exercises.bulkPut(
    broken.map((e) => {
      const region = regionOf.get(e.primaryMuscleId)
      return {
        ...e,
        aliases: e.aliases ?? [],
        movementPattern: region ? patternForRegion(region) : 'other',
      }
    }),
  )
}

async function seedProfile(): Promise<void> {
  const existing = await db.profiles.get(getActiveUserId())
  if (existing) {
    // Backfill fields added after this profile was written, so new UI isn't rendered against `undefined`.
    const backfill: Partial<Profile> = {}
    if (existing.weeklyWorkoutGoal === undefined) backfill.weeklyWorkoutGoal = 4
    if (existing.showAvatar === undefined) backfill.showAvatar = false
    if (existing.heightCm === undefined) backfill.heightCm = null
    if (existing.trainingGoal === undefined) backfill.trainingGoal = ''
    // An existing local profile predates onboarding; treat it as done.
    if (existing.onboardedAt === undefined) backfill.onboardedAt = Date.now()
    if (Object.keys(backfill).length > 0) {
      await db.profiles.update(existing.id, backfill)
    }
    return
  }

  const profile: Profile = {
    id: getActiveUserId(),
    displayName: 'You',
    unitWeight: 'lb',
    unitDistance: 'mi',
    unitLength: 'in',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekStartsOn: 1,
    weeklyWorkoutGoal: 4,
    defaultRestSeconds: 60,
    showRpe: false,
    bodyweightCacheKg: null,
    heightCm: null,
    trainingGoal: '',
    onboardedAt: null,
    theme: 'default',
    colorScheme: 'system',
    accentOverride: null,
    soundEnabled: true,
    autoStartRest: false,
    showAvatar: false,
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
  // Muscles are seeded first, so their regions are available to derive movement patterns.
  const regionOf = new Map((await db.muscles.toArray()).map((m) => [m.id, m.region]))

  for (const seed of EXERCISE_SEEDS) {
    const id = slugify(seed.name)
    if (existingIds.has(id)) continue
    missing.push({
      id,
      userId: null,
      name: seed.name,
      primaryMuscleId: seed.primary,
      aliases: seed.aliases ?? [],
      equipment: seed.equipment,
      // Derived, not seeded — see `domain/movement.ts`.
      movementPattern: patternForRegion(regionOf.get(seed.primary) ?? 'core'),
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
