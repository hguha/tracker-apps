/**
 * Populates the system library on first run.
 *
 * Idempotent and additive: it only inserts rows that are missing, so it can run
 * on every launch and can add new library entries in a later version without
 * touching anything the user has edited.
 */

import { db, syncStamp } from '@/db/database'
import { MOVEMENT_PATTERNS } from '@/domain/types'
import type { Exercise, MetricDefinition, Muscle, Profile } from '@/domain/types'
import { patternForRegion } from '@/domain/movement'
import { EXERCISE_SEEDS } from './exercises'
import { METRIC_SEEDS } from './metrics'
import { MUSCLE_SEEDS } from './muscles'

/**
 * The offline account's owner id. A real signed-in session replaces this with
 * the authenticated user's UID via `setActiveUserId`, so rows are stamped with
 * an id RLS will accept when they sync.
 */
export const LOCAL_USER_ID = 'local-user'

/**
 * The id every write is stamped with. Defaults to the offline account and is set
 * to the authenticated UID on sign-in (§11.1.3). Kept as module state rather than
 * threaded through every repository call, because it changes only at the
 * signed-out↔signed-in boundary and the tree remounts there anyway.
 */
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
  await repairExerciseRows()
  await repairArmsRegion()
}

/**
 * Migrates muscle rows off the retired 'arms' region (§10.2).
 *
 * 'Arms' was split into separate biceps and triceps regions. Rows seeded before
 * the split still carry `region: 'arms'`, which is no longer a valid Region and
 * would fall out of every chart and the region palette. Remap them: the triceps
 * muscle becomes 'triceps', everything else that was 'arms' (biceps, brachialis,
 * forearms) becomes 'biceps'. Idempotent — a no-op once no 'arms' rows remain.
 */
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

/**
 * Heals exercise rows written by an older build.
 *
 * Two repairs, both idempotent and cheap enough to run on every launch:
 *   - `aliases` can arrive undefined from a sync pull, which throws on render.
 *   - `movementPattern` used to be an eleven-value hand-tagged taxonomy
 *     (`horizontal_push`, `hinge`, …). It's now derived from the primary muscle,
 *     so any row still carrying a retired value is remapped. Without this, a
 *     stale `horizontal_push` would read as neither push nor cardio and the
 *     session title would silently stop saying "Push".
 */
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
    // Backfill fields added after this profile was first written, so an older
    // local row doesn't render new UI against `undefined`.
    const backfill: Partial<Profile> = {}
    if (existing.weeklyWorkoutGoal === undefined) backfill.weeklyWorkoutGoal = 4
    if (existing.showAvatar === undefined) backfill.showAvatar = false
    if (existing.heightCm === undefined) backfill.heightCm = null
    if (existing.trainingGoal === undefined) backfill.trainingGoal = ''
    // An existing local profile predates onboarding; treat it as done rather
    // than sending a returning user through setup.
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
  // Muscles are seeded first, so their regions are available to derive each
  // exercise's movement pattern.
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
