import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'

/**
 * Everything a screen reads from a `useLiveQuery` must be read-only. Dexie throws
 * "readwrite transaction in liveQuery context" if a querier writes, which has now broken this
 * app twice — first the boot chain, then `getProfile` creating its row on first read.
 *
 * A Dexie 'r' transaction rejects any write, so running each read inside one is a mechanical
 * check that no write has crept back in. Add a case here whenever a screen reads something new.
 */
async function readOnly<T>(read: () => Promise<T>): Promise<T> {
  return db.transaction('r', db.tables, read)
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  await seedFoods()
  repo.setActiveUserId('local-user')
})

describe('reads used from live queries never write', () => {
  const cases: [string, () => Promise<unknown>][] = [
    ['getProfile', () => repo.getProfile()],
    ['getDeviceSettings', () => repo.getDeviceSettings()],
    ['currentTargets', () => repo.currentTargets()],
    ['activeProgram', () => repo.activeProgram()],
    ['checkIns', () => repo.checkIns()],
    ['latestCheckIn', () => repo.latestCheckIn()],
    ['pendingCheckIn', () => repo.pendingCheckIn()],
    ['entriesForDay', () => repo.entriesForDay('2026-09-01')],
    ['entriesBetween', () => repo.entriesBetween('2026-08-01', '2026-09-01')],
    ['intakeByDay', () => repo.intakeByDay('2026-08-01', '2026-09-01')],
    ['weights', () => repo.weights()],
    ['countLoggedDays', () => repo.countLoggedDays()],
    ['frequentFoodIds', () => repo.frequentFoodIds()],
    ['searchFoods', () => repo.searchFoods('chicken')],
    ['getFood', () => repo.getFood('seed:0')],
    ['foodsByIds', () => repo.foodsByIds(['seed:0'])],
    ['findByBarcode', () => repo.findByBarcode('0000')],
  ]

  for (const [name, read] of cases) {
    it(name, async () => {
      await expect(readOnly(read)).resolves.not.toThrow()
    })
  }
})

describe('getProfile', () => {
  it('returns a default without persisting it, so a query can call it safely', async () => {
    const profile = await repo.getProfile()
    expect(profile.onboardingVersion).toBe(0)
    expect(await db.profiles.count()).toBe(0)
  })

  it('ensureProfile is what creates and queues the row', async () => {
    await repo.ensureProfile()
    expect(await db.profiles.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
  })

  it('ensureProfile is idempotent', async () => {
    await repo.ensureProfile()
    await repo.ensureProfile()
    expect(await db.profiles.count()).toBe(1)
  })

  it('saveProfile creates the row if it is missing', async () => {
    await repo.saveProfile({ theme: 'mono' })
    expect((await repo.getProfile()).theme).toBe('mono')
  })
})

describe('claimLocalData re-keys the profile', () => {
  it('moves the device-only profile onto the account id', async () => {
    await repo.saveProfile({ theme: 'slate' })
    await repo.claimLocalData('real-user')

    // The profile's primary key *is* its owner, so claiming has to re-key rather than re-own.
    expect(await db.profiles.get('local-user')).toBeUndefined()
    expect((await db.profiles.get('real-user'))?.theme).toBe('slate')
  })

  it('keeps the account’s own profile when one already exists', async () => {
    await repo.saveProfile({ theme: 'slate' })
    repo.setActiveUserId('real-user')
    await repo.saveProfile({ theme: 'mono' })

    await repo.claimLocalData('real-user')
    expect((await db.profiles.get('real-user'))?.theme).toBe('mono')
    expect(await db.profiles.count()).toBe(1)
  })
})
