import { beforeEach, describe, expect, it } from 'vitest'
import { db, syncStamp } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import { listStalledLifts } from '@/data/records'
import { WEEK_MS } from '@/lib/dates'
import type { PersonalRecord, RecordType } from '@/domain/types'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

let prCounter = 0
async function pr(
  exerciseId: string,
  recordType: RecordType,
  value: number,
  achievedAt: number,
): Promise<void> {
  const record: PersonalRecord = {
    id: `pr-${(prCounter += 1)}`,
    userId: LOCAL_USER_ID,
    exerciseId,
    equipment: 'barbell',
    recordType,
    value,
    achievedAt,
    setId: `set-${prCounter}`,
    ...syncStamp(),
  }
  await db.personalRecords.add(record)
}

describe('listStalledLifts (PR-consistent "stalled" definition)', () => {
  it('does NOT flag a lift that set a recent WEIGHT PR, even if e1RM did not improve', async () => {
    const now = Date.now()
    // The deadlift case: an old 345×3 gives the best e1RM (≈380)…
    await pr('deadlift', 'max_est_1rm', 380, now - 5 * WEEK_MS)
    // …but a recent 375×1 is a raw max_weight PR. That counts as progress.
    await pr('deadlift', 'max_weight', 375, now - 1 * WEEK_MS)

    const stalled = await listStalledLifts(2, now)
    expect(stalled.find((l) => l.exerciseId === 'deadlift')).toBeUndefined()
  })

  it('flags a lift whose every progress record is 2+ weeks old', async () => {
    const now = Date.now()
    await pr('bench_press', 'max_est_1rm', 140, now - 4 * WEEK_MS)
    await pr('bench_press', 'max_weight', 120, now - 4 * WEEK_MS)

    const stalled = await listStalledLifts(2, now)
    const bench = stalled.find((l) => l.exerciseId === 'bench_press')
    expect(bench).toBeDefined()
    expect(bench!.weeksStalled).toBe(4)
  })

  it('ignores non-progress records (a recent volume PR does not un-stall a lift)', async () => {
    const now = Date.now()
    await pr('bench_press', 'max_est_1rm', 140, now - 4 * WEEK_MS)
    await pr('bench_press', 'max_volume_session', 5000, now) // not a progress type
    const stalled = await listStalledLifts(2, now)
    expect(stalled.find((l) => l.exerciseId === 'bench_press')).toBeDefined()
  })
})
