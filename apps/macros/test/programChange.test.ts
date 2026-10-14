import { describe, expect, it } from 'vitest'
import { changeDirection, dietBreak, resumeAfterBreak, withGoal } from '@/features/settings/programChange'
import type { Program } from '@/domain/types'

function program(over: Partial<Program> = {}): Program {
  return {
    id: 'p1',
    userId: 'u1',
    goal: 'lose',
    ratePctPerWeek: -0.75,
    startedAt: 1,
    endedAt: null,
    coachingMode: 'collaborative',
    proteinGPerKg: 2,
    fatMinPctKcal: 30,
    cycling: { multipliers: [0.9, 0.9, 0.9, 0.9, 0.9, 1.25, 1.25] },
    targetKg: 75,
    targetAt: null,
    startKg: 82,
    reachedAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    clientRev: 0,
    ...over,
  }
}

describe('diet breaks', () => {
  it('holds at maintenance with the same tuning', () => {
    const input = dietBreak(program())
    expect(input).toMatchObject({
      goal: 'maintain',
      ratePctPerWeek: 0,
      proteinGPerKg: 2,
      fatMinPctKcal: 30,
      coachingMode: 'collaborative',
      targetKg: null,
    })
    expect(input.cycling).toEqual(program().cycling)
  })

  it('resumes at the pace held before the break', () => {
    const onBreak = program({ id: 'p2', goal: 'maintain', ratePctPerWeek: 0, targetKg: null })
    const input = resumeAfterBreak(onBreak, [onBreak, program()], 'lose')
    expect(input.ratePctPerWeek).toBe(-0.75)
  })

  it('resumes the other direction at its default pace', () => {
    const onBreak = program({ id: 'p2', goal: 'maintain', ratePctPerWeek: 0, targetKg: null })
    expect(resumeAfterBreak(onBreak, [onBreak, program()], 'gain').ratePctPerWeek).toBe(0.25)
  })

  it('does not carry a losing goal weight into building', () => {
    const onBreak = program({ id: 'p2', goal: 'maintain', ratePctPerWeek: 0, targetKg: null })
    expect(resumeAfterBreak(onBreak, [onBreak, program()], 'gain').targetKg).toBeNull()
  })
})

describe('changing direction', () => {
  it('starts at the steady pace and keeps the goal weight', () => {
    expect(changeDirection(program(), 'gain')).toMatchObject({ ratePctPerWeek: 0.25, targetKg: 75 })
  })

  it('drops the goal weight for maintenance', () => {
    expect(changeDirection(program(), 'maintain')).toMatchObject({ ratePctPerWeek: 0, targetKg: null })
  })

  it('keeps calorie cycling', () => {
    expect(changeDirection(program(), 'gain').cycling).toEqual(program().cycling)
  })
})

describe('withGoal', () => {
  it('carries every tuning field into the new program', () => {
    expect(withGoal(program(), 'gain', 0.25, 90)).toEqual({
      goal: 'gain',
      ratePctPerWeek: 0.25,
      proteinGPerKg: 2,
      fatMinPctKcal: 30,
      coachingMode: 'collaborative',
      cycling: program().cycling,
      targetKg: 90,
    })
  })
})
