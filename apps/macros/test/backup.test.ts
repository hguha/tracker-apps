import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dayKey } from '@tracker-engine/core'
import { db } from '@/db'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { exportToCsv, exportToJson, importBackup, parseBackup } from '@/data/backup'
import { EMPTY_NUTRIENTS } from '@/domain/types'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  await seedFoods()
  repo.setActiveUserId('local-user')
})

describe('exportToCsv', () => {
  it('writes one row per entry, with the food name and grams', async () => {
    const [food] = await repo.searchFoods('chicken breast')
    await repo.logFood({
      food: food!,
      grams: 150,
      meal: 'lunch',
      eatenAt: Date.parse(`${dayKey(Date.now())}T13:05:00`),
    })

    const csv = await exportToCsv()
    const [header, row] = csv.split('\n')
    expect(header).toBe('day,time,meal,item,grams,kcal,protein_g,carbs_g,fat_g,fibre_g,source')
    expect(row).toContain('13:05,lunch,')
    expect(row).toContain('150')
  })

  it('quotes a name containing a comma, so the columns still line up', async () => {
    const id = await repo.saveCustomFood({
      description: 'Wrap, chicken, large',
      per100: { ...EMPTY_NUTRIENTS, kcal: 200, proteinMg: 14_000, carbsMg: 20_000, fatMg: 7_000 },
    })
    await repo.logFood({ food: (await repo.getFood(id))!, grams: 100, meal: 'lunch' })

    const csv = await exportToCsv()
    expect(csv).toContain('"Wrap, chicken, large"')
    expect(csv.split('\n')[1]!.split(',')).toHaveLength(13)
  })

  it('leaves an unrecorded nutrient blank rather than writing 0', async () => {
    await repo.logQuickAdd(
      { ...EMPTY_NUTRIENTS, kcal: 300, proteinMg: 10_000, carbsMg: 30_000, fatMg: 10_000 },
      'snack',
      'Cafeteria mystery',
    )
    const row = (await exportToCsv()).split('\n')[1]!
    expect(row.split(',').at(-2)).toBe('')
  })
})

describe('importBackup', () => {
  it('drops a row with no id and imports the rest', async () => {
    const backup = parseBackup(
      JSON.stringify({
        format: JSON.parse(await exportToJson()).format,
        bodyWeights: [
          { id: 'bw:a', day: '2026-10-01', kg: 80 },
          { day: '2026-10-02', kg: 79 },
        ],
      }),
    )

    await importBackup(backup)
    expect((await db.bodyWeights.toArray()).map((row) => row.id)).toEqual(['bw:local-user:2026-10-01'])
    expect((await db.outbox.toArray()).map((entry) => entry.rowId)).toEqual(['bw:local-user:2026-10-01'])
  })

  it('writes nothing when one table fails to import', async () => {
    const [food] = await repo.searchFoods('chicken breast')
    await repo.logFood({ food: food!, grams: 100, meal: 'lunch' })
    const backup = parseBackup(await exportToJson())
    await db.logEntries.clear()
    await db.outbox.clear()
    backup.bodyWeights = [{ ...backup.logEntries[0]!, id: 'bw:x' } as never]
    vi.spyOn(db.bodyWeights, 'bulkPut').mockRejectedValueOnce(new Error('disk full'))

    await expect(importBackup(backup)).rejects.toThrow('disk full')
    expect(await db.logEntries.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('importBackup onto another account', () => {
  it('re-owns rows to the signed-in user, keeps deletions, and re-keys per-day rows', async () => {
    const day = '2026-10-01'
    const backup = parseBackup(
      JSON.stringify({
        format: JSON.parse(await exportToJson()).format,
        bodyWeights: [{ id: `bw:old-user:${day}`, userId: 'old-user', day, kg: 80, deletedAt: null }],
        waterLogs: [{ id: `w:old-user:${day}`, userId: 'old-user', day, ml: 500, deletedAt: null }],
        programs: [{ id: 'p-gone', userId: 'old-user', deletedAt: 1_000 }],
      }),
    )
    repo.setActiveUserId('new-user')
    await db.profiles.put({ ...(await repo.getProfile()), id: 'someone-else' })

    await importBackup(backup)

    expect((await db.bodyWeights.toArray()).map((r) => [r.id, r.userId])).toEqual([
      [`bw:new-user:${day}`, 'new-user'],
    ])
    expect((await db.waterLogs.toArray()).map((r) => [r.id, r.userId])).toEqual([
      [`w:new-user:${day}`, 'new-user'],
    ])
    expect((await db.programs.get('p-gone'))?.deletedAt).toBe(1_000)
  })

  it('re-keys a check-in onto the signed-in user', async () => {
    const backup = parseBackup(
      JSON.stringify({
        format: JSON.parse(await exportToJson()).format,
        checkIns: [
          { id: 'ci:old-user:2026-09-28', userId: 'old-user', weekStart: '2026-09-28', deletedAt: null },
        ],
      }),
    )
    repo.setActiveUserId('new-user')

    await importBackup(backup)

    expect((await db.checkIns.toArray()).map((r) => [r.id, r.userId])).toEqual([
      ['ci:new-user:2026-09-28', 'new-user'],
    ])
  })
})
