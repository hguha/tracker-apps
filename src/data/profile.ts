import { db } from '@/db/database'
import { LOCAL_USER_ID, getActiveUserId } from '@/db/seed'
import { type Profile } from '@/domain/types'
import { enqueue, patchRow } from './outbox'

export async function getProfile(): Promise<Profile> {
  const profile = await db.profiles.get(getActiveUserId())
  if (!profile) throw new Error('Profile missing — seeding did not run')
  return profile
}

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  await patchRow(db.profiles, 'profiles', getActiveUserId(), patch)
}

// Re-owns device-only ('local-user') rows to a real uid on sign-in so server RLS
// accepts them (§11.1.3). One transaction so a crash can't half-migrate ownership.
//
// Chained rows carry no userId, so children of parents that weren't re-owned
// this pass must be skipped — enqueueing them all would re-push already-synced
// data on every upgrade.

export async function claimLocalData(newUserId: string): Promise<number> {
  if (newUserId === LOCAL_USER_ID) return 0

  let claimed = 0
  const now = Date.now()

  await db.transaction(
    'rw',
    [
      db.profiles,
      db.workouts,
      db.templates,
      db.metricEntries,
      db.exercises,
      db.metricDefinitions,
      db.workoutExercises,
      db.sets,
      db.templateExercises,
      db.outbox,
      // enqueue reads editSnapshots, so it must be in the transaction scope too.
      db.editSnapshots,
    ],
    async () => {
      const localProfile = await db.profiles.get(LOCAL_USER_ID)
      if (localProfile) {
        const existing = await db.profiles.get(newUserId)
        const merged: Profile = {
          ...localProfile,
          ...(existing ?? {}),
          // Local preferences win — set up on this device.
          unitWeight: localProfile.unitWeight,
          unitDistance: localProfile.unitDistance,
          unitLength: localProfile.unitLength,
          weekStartsOn: localProfile.weekStartsOn,
          weeklyWorkoutGoal: localProfile.weeklyWorkoutGoal,
          defaultRestSeconds: localProfile.defaultRestSeconds,
          showRpe: localProfile.showRpe,
          showAvatar: localProfile.showAvatar,
          autoStartRest: localProfile.autoStartRest,
          soundEnabled: localProfile.soundEnabled,
          theme: localProfile.theme,
          colorScheme: localProfile.colorScheme,
          accentOverride: localProfile.accentOverride,
          bodyweightCacheKg: localProfile.bodyweightCacheKg,
          heightCm: existing?.heightCm ?? localProfile.heightCm ?? null,
          trainingGoal: localProfile.trainingGoal || (existing?.trainingGoal ?? ''),
          onboardedAt: existing?.onboardedAt ?? localProfile.onboardedAt ?? null,
          id: newUserId,
          updatedAt: now,
          deletedAt: null,
          clientRev: (existing?.clientRev ?? localProfile.clientRev) + 1,
        }
        await db.profiles.put(merged)
        await db.profiles.delete(LOCAL_USER_ID)
        await enqueue('profiles', newUserId)
        claimed += 1
      }

      const claimedWorkoutIds = new Set<string>()
      const claimedTemplateIds = new Set<string>()

      const reownOwned = async <T extends { id: string; userId: string | null; clientRev: number }>(
        table: string,
        store: { toArray(): Promise<T[]>; put(row: T): Promise<unknown> },
        track?: Set<string>,
      ): Promise<void> => {
        for (const row of await store.toArray()) {
          if (row.userId !== LOCAL_USER_ID) continue
          const next = {
            ...row,
            userId: newUserId,
            updatedAt: now,
            clientRev: row.clientRev + 1,
          }
          await store.put(next)
          await enqueue(table, row.id)
          track?.add(row.id)
          claimed += 1
        }
      }

      await reownOwned('workouts', db.workouts as never, claimedWorkoutIds)
      await reownOwned('templates', db.templates as never, claimedTemplateIds)
      await reownOwned('metricEntries', db.metricEntries as never)
      await reownOwned('exercises', db.exercises as never)
      await reownOwned('metricDefinitions', db.metricDefinitions as never)

      // No parents re-owned → all chained rows are already the caller's.
      if (claimedWorkoutIds.size === 0 && claimedTemplateIds.size === 0) return

      for (const we of await db.workoutExercises.toArray()) {
        if (we.deletedAt !== null) continue
        if (!claimedWorkoutIds.has(we.workoutId)) continue
        const next = { ...we, updatedAt: now, clientRev: we.clientRev + 1 }
        await db.workoutExercises.put(next)
        await enqueue('workoutExercises', we.id)
        claimed += 1
      }

      const workoutIdOfWe = new Map<string, string>()
      for (const we of await db.workoutExercises.toArray()) {
        workoutIdOfWe.set(we.id, we.workoutId)
      }
      for (const set of await db.sets.toArray()) {
        if (set.deletedAt !== null) continue
        const workoutId = workoutIdOfWe.get(set.workoutExerciseId)
        if (!workoutId || !claimedWorkoutIds.has(workoutId)) continue
        const next = { ...set, updatedAt: now, clientRev: set.clientRev + 1 }
        await db.sets.put(next)
        await enqueue('sets', set.id)
        claimed += 1
      }

      for (const te of await db.templateExercises.toArray()) {
        if (te.deletedAt !== null) continue
        if (!claimedTemplateIds.has(te.templateId)) continue
        const next = { ...te, updatedAt: now, clientRev: te.clientRev + 1 }
        await db.templateExercises.put(next)
        await enqueue('templateExercises', te.id)
        claimed += 1
      }
    },
  )

  return claimed
}

// ----- exercises -----
