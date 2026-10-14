import { createOwnerGuard, touch } from '@tracker-engine/local-first'
import { LOCAL_USER_ID } from '@tracker-engine/auth'
import { db, OWNED_TABLES, OWNER_KEY } from '@/db'
import type { Table } from 'dexie'
import { enqueue } from '@/data/outbox'
import { weightIdFor } from './body'
import { checkInIdFor } from './program'
import { waterIdFor } from './water'
import type { BodyWeightRow, CheckIn, WaterRow } from '@/domain/types'

export function claimLocalData(userId: string): Promise<number> {
  return db.transaction('rw', [...OWNED_TABLES, db.outbox], async () => {
    let claimed = await claimProfile(userId)
    for (const [table, store] of [
      ['customFoods', db.customFoods],
      ['logEntries', db.logEntries],
      ['recipes', db.recipes],
      ['mealTemplates', db.mealTemplates],
      ['programs', db.programs],
    ] as const) {
      const rows = await store.where('userId').equals(LOCAL_USER_ID).toArray()
      for (const row of rows) {
        await store.update(row.id, { userId, updatedAt: Date.now() })
        await enqueue(table, row.id)
        claimed += 1
      }
    }
    claimed += await rekey('bodyWeights', db.bodyWeights as Table<BodyWeightRow, string>, userId, (owner, row) =>
      weightIdFor(owner, row.day),
    )
    claimed += await rekey('waterLogs', db.waterLogs as Table<WaterRow, string>, userId, (owner, row) =>
      waterIdFor(owner, row.day),
    )
    claimed += await rekey('checkIns', db.checkIns as Table<CheckIn, string>, userId, (owner, row) =>
      checkInIdFor(owner, row.weekStart),
    )
    return claimed
  })
}

async function claimProfile(userId: string): Promise<number> {
  const stale = await db.profiles.get(LOCAL_USER_ID)
  if (!stale) return 0
  await db.profiles.delete(LOCAL_USER_ID)
  if (await db.profiles.get(userId)) return 0
  await db.profiles.put({ ...stale, id: userId, ...touch(stale.clientRev) })
  await enqueue('profiles', userId)
  return 1
}

/**
 * Water has to be re-keyed, not just re-owned.
 *
 * Its id embeds the owner — `w:${userId}:${day}` — because that determinism is what stops eight taps
 * of "+ a glass" becoming eight rows. Updating `userId` in place would leave the old owner in the id,
 * so the next `addWater` on the same day would compute a *different* id, insert a second row, and hit
 * the server's unique (user_id, day) index. Delete and re-insert, exactly as the profile does.
 */
async function rekey<Row extends { id: string; userId: string; clientRev: number }>(
  table: string,
  store: Table<Row, string>,
  userId: string,
  idFor: (owner: string, row: Row) => string,
): Promise<number> {
  const stale = await store.where('userId').equals(LOCAL_USER_ID).toArray()
  let claimed = 0
  for (const row of stale) {
    const id = idFor(userId, row)
    if (!(await store.get(id))) {
      await store.put({ ...row, id, userId, ...touch(row.clientRev) })
      await enqueue(table, id)
      claimed += 1
    }
    await store.delete(row.id)
  }
  return claimed
}

const owner = createOwnerGuard({
  storageKey: OWNER_KEY,
  tables: OWNED_TABLES,
  localUserId: LOCAL_USER_ID,
  claim: claimLocalData,
})

export const assertDbOwner = (ownerId: string): Promise<boolean> => owner.assertOwner(ownerId)

export const adoptSession = (ownerId: string) => owner.adopt(ownerId)

export const setDbOwner = (ownerId: string): void => owner.setOwner(ownerId)

export const clearDbOwner = (): void => owner.clearOwner()

/** Wipes this device's copy, keeping the seeded food reference data. */
export async function clearLocalData(): Promise<void> {
  await Promise.all(OWNED_TABLES.map((table) => table.clear()))
}
