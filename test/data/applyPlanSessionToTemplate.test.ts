import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

async function namesOf(templateId: string): Promise<string[]> {
  const tes = await repo.listTemplateExercises(templateId)
  const library = await repo.listExercises()
  return tes.map((te) => library.find((e) => e.id === te.exerciseId)?.name ?? te.exerciseId)
}

describe('applyPlanSessionToTemplate', () => {
  it('replaces the exercise set: retargets a kept lift, adds new, drops missing', async () => {
    const templateId = await repo.createTemplate('Push')
    await repo.addExerciseToTemplate(templateId, 'bench_press', 'barbell')
    await repo.addExerciseToTemplate(templateId, 'back_squat', 'barbell') // will be dropped

    const { unmatched } = await repo.applyPlanSessionToTemplate(
      templateId,
      {
        exercises: [
          { name: 'Bench Press', sets: 5, repLow: 5, repHigh: 5, weight: 100, equipment: 'barbell', autoProgress: true },
          { name: 'Overhead Press', sets: 3, repLow: 8, repHigh: 12, weight: 40, equipment: 'barbell' },
        ],
      },
      'kg',
    )

    expect(unmatched).toEqual([])
    expect(await namesOf(templateId)).toEqual(['Bench Press', 'Overhead Press'])

    const tes = await repo.listTemplateExercises(templateId)
    const bench = tes.find((t) => t.exerciseId === 'bench_press')!
    expect(bench.targetSets).toBe(5)
    expect(bench.targetWeightKg).toBe(100) // kg unit → no conversion
    expect(bench.progression).not.toBeNull()
    // Kept lifts keep their position order from the new session.
    expect(tes.map((t) => t.position)).toEqual([0, 1])
  })

  it('preserves the row id of a lift that stays', async () => {
    const templateId = await repo.createTemplate('Push')
    const originalId = await repo.addExerciseToTemplate(templateId, 'bench_press', 'barbell')

    await repo.applyPlanSessionToTemplate(
      templateId,
      { exercises: [{ name: 'Bench Press', sets: 4, repLow: 6, repHigh: 8, weight: 90, equipment: 'barbell' }] },
      'kg',
    )

    const tes = await repo.listTemplateExercises(templateId)
    expect(tes).toHaveLength(1)
    expect(tes[0]!.id).toBe(originalId)
    expect(tes[0]!.targetSets).toBe(4)
  })

  it('reports names it could not match and leaves them out', async () => {
    const templateId = await repo.createTemplate('Push')
    const { unmatched } = await repo.applyPlanSessionToTemplate(
      templateId,
      {
        exercises: [
          { name: 'Bench Press', sets: 3, repLow: 8, repHigh: 8, weight: null },
          { name: 'Nonexistent Zercher Wobble', sets: 3, repLow: 8, repHigh: 8, weight: null },
        ],
      },
      'kg',
    )
    expect(unmatched).toEqual(['Nonexistent Zercher Wobble'])
    expect(await namesOf(templateId)).toEqual(['Bench Press'])
  })
})
