import { touch } from '@tracker-engine/local-first'
import { db, owner } from '@/db'
import { enqueue } from '@/data/outbox'

/**
 * Re-owns device-only rows for a real account and re-queues them.
 *
 * Must run *before* `owner.assertOwner`, or the guard sees rows belonging to someone else
 * and wipes exactly what was just claimed.
 */
export async function claimLocalData(userId: string): Promise<number> {
  const tables = [
    ['profiles', db.profiles],
    ['customFoods', db.customFoods],
    ['logEntries', db.logEntries],
    ['bodyWeights', db.bodyWeights],
    ['recipes', db.recipes],
    ['mealTemplates', db.mealTemplates],
    ['programs', db.programs],
    ['checkIns', db.checkIns],
  ] as const

  let claimed = 0
  for (const [table, store] of tables) {
    if (table === 'profiles') {
      // The profile's primary key *is* the owner, so it can't be re-owned in place — the row
      // has to be re-keyed, which means delete and re-insert.
      const stale = (await db.profiles.toArray()).filter((row) => row.id !== userId)
      for (const row of stale) {
        const existing = await db.profiles.get(userId)
        if (!existing) {
          await db.profiles.put({ ...row, id: userId, ...touch(row.clientRev) })
          await enqueue('profiles', userId)
          claimed += 1
        }
        await db.profiles.delete(row.id)
      }
      continue
    }
    const rows = await store.where('userId').notEqual(userId).toArray()
    for (const row of rows) {
      await store.update(row.id, { userId, updatedAt: Date.now() })
      await enqueue(table, row.id)
      claimed += 1
    }
  }

  claimed += await claimWater(userId)
  return claimed
}

/**
 * Water has to be re-keyed, not just re-owned.
 *
 * Its id embeds the owner — `w:${userId}:${day}` — because that determinism is what stops eight taps
 * of "+ a glass" becoming eight rows. Updating `userId` in place would leave the old owner in the id,
 * so the next `addWater` on the same day would compute a *different* id, insert a second row, and hit
 * the server's unique (user_id, day) index. Delete and re-insert, exactly as the profile does.
 */
async function claimWater(userId: string): Promise<number> {
  const stale = await db.waterLogs.where('userId').notEqual(userId).toArray()
  let claimed = 0
  for (const row of stale) {
    const id = `w:${userId}:${row.day}`
    const existing = await db.waterLogs.get(id)
    // A row already under the new owner wins: it belongs to the account, and this one is a local
    // draft for the same day.
    if (!existing) {
      await db.waterLogs.put({ ...row, id, userId, ...touch(row.clientRev) })
      await enqueue('waterLogs', id)
      claimed += 1
    }
    await db.waterLogs.delete(row.id)
  }
  return claimed
}

export const assertDbOwner = (ownerId: string): Promise<boolean> => owner.assertOwner(ownerId)

export const setDbOwner = (ownerId: string): void => owner.setOwner(ownerId)

export const clearDbOwner = (): void => owner.clearOwner()

/** Wipes this device's copy, keeping the seeded food reference data. */
export async function clearLocalData(): Promise<void> {
  await Promise.all([
    db.profiles.clear(),
    db.customFoods.clear(),
    db.logEntries.clear(),
    db.bodyWeights.clear(),
    db.waterLogs.clear(),
    db.recipes.clear(),
    db.mealTemplates.clear(),
    db.programs.clear(),
    db.checkIns.clear(),
    db.outbox.clear(),
    db.deadLetter.clear(),
    db.syncState.clear(),
  ])
}
