// Destructive, whole-database operations: the local wipe and the device-owner
// guard that stops one account's data being read under another's id.

import { createOwnerGuard } from '@tracker-engine/local-first'
import { db } from '@/db/database'
import { LOCAL_USER_ID } from '@/db/seed'
import { claimLocalData } from './profile'

const owner = createOwnerGuard({
  storageKey: 'fitnote.dbOwner',
  tables: [{ clear: () => clearLocalData() }],
  localUserId: LOCAL_USER_ID,
  claim: claimLocalData,
})

// Enforces that the local database holds only the signed-in account's data (§11.1.3),
// since IndexedDB reads aren't scoped by user; switching accounts wipes the previous
// one's rows. Returns whether it wiped, so the caller can resync rather than show an empty app.
export const assertDbOwner = (userId: string): Promise<boolean> => owner.assertOwner(userId)

export const adoptSession = (userId: string) => owner.adopt(userId)

export const setDbOwner = (userId: string): void => owner.setOwner(userId)

export const clearDbOwner = (): void => owner.clearOwner()

export async function clearLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.profiles,
      db.workouts,
      db.workoutExercises,
      db.sets,
      db.templates,
      db.templateExercises,
      db.personalRecords,
      db.metricEntries,
      db.exercises,
      db.metricDefinitions,
      db.lastPerformance,
      db.placeholderOverrides,
      db.editSnapshots,
      db.coachConversations,
      db.outbox,
      db.deadLetter,
      db.syncState,
    ],
    async () => {
      await db.coachConversations.clear()
      await db.workouts.clear()
      await db.workoutExercises.clear()
      await db.sets.clear()
      await db.templates.clear()
      await db.templateExercises.clear()
      await db.personalRecords.clear()
      await db.metricEntries.clear()
      await db.lastPerformance.clear()
      await db.placeholderOverrides.clear()
      await db.editSnapshots.clear()
      await db.profiles.clear()
      // User-created library rows only — system rows (userId null) are shared and re-seeded at boot. Both tables are user-extensible.
      for (const store of [db.exercises, db.metricDefinitions]) {
        await store.filter((row) => row.userId !== null).delete()
      }
      await db.outbox.clear()
      await db.deadLetter.clear()
      await db.syncState.clear()
    },
  )
}
