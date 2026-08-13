import { db } from '@/db/database'
import { LOCAL_USER_ID, getActiveUserId } from '@/db/seed'
import { type Profile, type Workout } from '@/domain/types'
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

export async function claimLocalData(newUserId: string): Promise<number> {
  if (newUserId === LOCAL_USER_ID) return 0

  const owned = [
    { table: 'workouts', store: db.workouts },
    { table: 'templates', store: db.templates },
    { table: 'metricEntries', store: db.metricEntries },
    { table: 'exercises', store: db.exercises },
    { table: 'metricDefinitions', store: db.metricDefinitions },
  ] as const

  const chained = [
    { table: 'workoutExercises', store: db.workoutExercises },
    { table: 'sets', store: db.sets },
    { table: 'templateExercises', store: db.templateExercises },
  ] as const

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
        await enqueue('profiles', 'update', newUserId, merged, merged.clientRev)
        claimed += 1
      }

      for (const { table, store } of owned) {
        const rows = await (store as typeof db.workouts).toArray()
        for (const row of rows) {
          if ((row as { userId: string | null }).userId !== LOCAL_USER_ID) continue
          const next = {
            ...row,
            userId: newUserId,
            updatedAt: now,
            clientRev: row.clientRev + 1,
          }
          await (store as typeof db.workouts).put(next as Workout)
          await enqueue(table, 'update', row.id, next, next.clientRev)
          claimed += 1
        }
      }

      for (const { table, store } of chained) {
        const rows = await (store as typeof db.sets).toArray()
        for (const row of rows) {
          if (row.deletedAt !== null) continue
          const next = { ...row, updatedAt: now, clientRev: row.clientRev + 1 }
          await (store as typeof db.sets).put(next)
          await enqueue(table, 'update', row.id, next, next.clientRev)
          claimed += 1
        }
      }
    },
  )

  return claimed
}

// ----- exercises -----
