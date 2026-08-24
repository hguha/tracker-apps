import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import * as repo from '@/data/repository'
import {
  executeRetrievalTool,
  isActionTool,
  toolToAction,
  TOOL_DECLARATIONS,
} from '@/features/coach/tools'
import { mockCoachProvider } from '@/features/coach/mockProvider'
import type { CoachContext } from '@/features/coach/context'
import type { GeminiContent } from '@/features/coach/types'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

// A finished session with one completed set of the given lift.
async function logSession(exerciseId: string, weightKg: number, reps: number): Promise<void> {
  const workoutId = await repo.startWorkout()
  const weId = await repo.addExerciseToWorkout(workoutId, exerciseId, 'barbell')
  await repo.addSet({ workoutExerciseId: weId, weightKg, reps, isCompleted: true })
  await repo.finishWorkout(workoutId)
}

describe('coach tool registry', () => {
  it('declares tools with names + JSON-schema parameters', () => {
    const names = TOOL_DECLARATIONS.map((d) => d.name)
    expect(names).toContain('getExerciseHistory')
    expect(names).toContain('findWorkouts')
    expect(names).toContain('proposePlan')
    for (const d of TOOL_DECLARATIONS) {
      expect(typeof d.description).toBe('string')
      expect(d.parameters).toHaveProperty('type', 'object')
    }
  })

  it('classifies action vs retrieval tools', () => {
    expect(isActionTool('proposePlan')).toBe(true)
    expect(isActionTool('proposeTemplateUpdate')).toBe(true)
    expect(isActionTool('getExerciseHistory')).toBe(false)
  })

  it('getExerciseHistory returns logged sessions for a resolved lift', async () => {
    await logSession('bench_press', 100, 5)
    const result = (await executeRetrievalTool('getExerciseHistory', {
      exercise: 'Bench Press',
    })) as { exercise: string; totalSessions: number; sessions: unknown[] }
    expect(result.exercise).toBe('Bench Press')
    expect(result.totalSessions).toBe(1)
    expect(result.sessions).toHaveLength(1)
  })

  it('getExerciseHistory reports an unmatched name instead of throwing', async () => {
    const result = (await executeRetrievalTool('getExerciseHistory', {
      exercise: 'Zercher Wobble Press',
    })) as { error?: string }
    expect(result.error).toContain('No exercise matches')
  })

  it('findWorkouts filters by an included exercise', async () => {
    await logSession('bench_press', 100, 5)
    await logSession('back_squat', 140, 5)

    const all = (await executeRetrievalTool('findWorkouts', {})) as { matches: number }
    expect(all.matches).toBe(2)

    const benchOnly = (await executeRetrievalTool('findWorkouts', {
      exercise: 'Bench Press',
    })) as { matches: number; workouts: { exercises: string[] }[] }
    expect(benchOnly.matches).toBe(1)
    expect(benchOnly.workouts[0]!.exercises.join(' ')).toContain('Bench Press')
  })

  it('proposePlan maps args into a plan action', async () => {
    const action = await toolToAction('proposePlan', {
      overview: 'A push day',
      programName: null,
      durationWeeks: null,
      sessions: [
        {
          name: 'Push A',
          exercises: [
            { name: 'Bench Press', sets: 5, repLow: 5, repHigh: 5, note: 'heavy', autoProgress: true },
          ],
        },
      ],
    })
    expect(action?.kind).toBe('plan')
    if (action?.kind === 'plan') {
      expect(action.plan.sessions[0]!.exercises[0]!.name).toBe('Bench Press')
      expect(action.plan.sessions[0]!.exercises[0]!.autoProgress).toBe(true)
    }
  })

  it('proposeTemplateUpdate resolves an existing template by name', async () => {
    const templateId = await repo.createTemplate('Leg Day')
    const action = await toolToAction('proposeTemplateUpdate', {
      templateName: 'leg day', // case-insensitive
      note: 'more squats',
      session: { name: 'Leg Day', exercises: [] },
    })
    expect(action?.kind).toBe('templateUpdate')
    if (action?.kind === 'templateUpdate') expect(action.templateId).toBe(templateId)
  })
})

describe('mock coach chat fallback', () => {
  const context = {} as CoachContext
  const userTurn = (text: string): GeminiContent[] => [{ role: 'user', parts: [{ text }] }]

  it('answers a plan-like message with a drafted plan card', async () => {
    const result = await mockCoachProvider.chat!(userTurn('give me a push day'), context)
    expect(result.action?.kind).toBe('plan')
  })

  it('answers a general question with text and no card', async () => {
    const result = await mockCoachProvider.chat!(userTurn('what should I focus on?'), context)
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.action).toBeUndefined()
  })
})
