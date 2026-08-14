// Populates the system library on first run; idempotent and additive, safe to run every launch.

import { db, syncStamp, touch } from '@/db/database'
import { REGIONS, type Region } from '@/domain/types'
import type { Exercise, MetricDefinition, Profile } from '@/domain/types'
import { patternForRegion } from '@/domain/movement'
import { enqueue } from '@/data/outbox'
import { BASE_EXERCISES } from './bases'
import { METRIC_SEEDS } from './metrics'

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
  await seedExercises()
  await seedMetricDefinitions()
  await repairExerciseTaxonomy()
}

// Old custom exercises can carry taxonomy values the current server enums reject,
// which fail their upsert permanently (a real one seen in the logs: a
// pre-collapse `movement_pattern` like `horizontal_press`, gone since migration
// 0013). Two coercions make them syncable again: a retired `arms` region splits
// into biceps/triceps, and `movement_pattern` is re-derived from the region
// (it's derived, not authoritative — §4.3). User-owned fixes are re-enqueued so
// the corrected row reaches the server; system rows are already correct.
async function repairExerciseTaxonomy(): Promise<void> {
  const validRegion = new Set<string>(REGIONS)
  for (const row of await db.exercises.toArray()) {
    let region = row.region as string
    // 'arms' predates the biceps/triceps split; recover the side from the pattern.
    if (!validRegion.has(region)) {
      region = row.movementPattern === 'push' ? 'triceps' : 'biceps'
    }
    const movementPattern = patternForRegion(region as Region)
    if (region === row.region && movementPattern === row.movementPattern) continue

    await db.exercises.update(row.id, {
      region: region as Region,
      movementPattern,
      ...touch(row.clientRev),
    })
    if (row.userId !== null) {
      const fixed = await db.exercises.get(row.id)
      if (fixed) await enqueue('exercises', 'update', fixed.id, fixed, fixed.clientRev)
    }
  }
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
    // 0 trails the current ONBOARDING_VERSION, so existing accounts replay the
    // reworked walkthrough once (§11.1.3).
    if (existing.onboardingVersion === undefined) backfill.onboardingVersion = 0
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
    onboardingVersion: 0,
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

async function seedExercises(): Promise<void> {
  const existingIds = new Set(await db.exercises.toCollection().primaryKeys())
  const missing: Exercise[] = []

  for (const base of BASE_EXERCISES) {
    if (existingIds.has(base.id)) continue
    missing.push({
      id: base.id,
      userId: null,
      name: base.name,
      region: base.region,
      aliases: base.aliases,
      // Derived, not seeded — see `domain/movement.ts`.
      movementPattern: patternForRegion(base.region),
      trackingType: base.trackingType,
      bodyweightFactor: base.bodyweightFactor,
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
