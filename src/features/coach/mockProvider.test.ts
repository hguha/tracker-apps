import { describe, expect, it } from 'vitest'
import { mockCoachProvider } from './mockProvider'
import type { CoachSummary, ExerciseAgg } from './summary'

function ex(partial: Partial<ExerciseAgg> & { name: string }): ExerciseAgg {
  return {
    name: partial.name,
    region: partial.region ?? 'chest',
    pattern: partial.pattern ?? 'horizontal_push',
    equipment: partial.equipment ?? 'barbell',
    sessions: partial.sessions ?? 3,
    totalSets: partial.totalSets ?? 9,
    bestE1rmKg: partial.bestE1rmKg ?? 100,
    recentTopSetKg: partial.recentTopSetKg ?? 90,
    repRange: partial.repRange ?? [8, 10],
    lastWeekOffset: partial.lastWeekOffset ?? 0,
  }
}

function summary(partial: Partial<CoachSummary> = {}): CoachSummary {
  return {
    version: 1,
    unitWeight: 'lb',
    weeklyWorkoutGoal: 4,
    weeksCovered: 12,
    totalWorkouts: partial.totalWorkouts ?? 8,
    weeks: partial.weeks ?? [
      { weekOffset: 0, workouts: 4, sets: 40, volumeKg: 12000 },
      { weekOffset: -1, workouts: 4, sets: 40, volumeKg: 12000 },
    ],
    regionSets: partial.regionSets ?? [
      { region: 'chest', sets: 12 },
      { region: 'back', sets: 12 },
      { region: 'legs', sets: 10 },
    ],
    exercises: partial.exercises ?? [ex({ name: 'Barbell Bench Press' })],
  }
}

describe('mockCoachProvider — critique', () => {
  it('flags an untrained region', async () => {
    const r = await mockCoachProvider.respond(
      summary({ regionSets: [{ region: 'chest', sets: 20 }] }),
      { kind: 'critique' },
    )
    expect(r.kind).toBe('critique')
    if (r.kind !== 'critique') return
    const text = [...r.critique.observations, ...r.critique.suggestions].join(' ')
    expect(text).toMatch(/Back|Legs|Shoulders/)
  })

  it('flags a push/pull imbalance', async () => {
    const r = await mockCoachProvider.respond(
      summary({
        regionSets: [
          { region: 'chest', sets: 20 },
          { region: 'triceps', sets: 10 },
          { region: 'back', sets: 4 },
          { region: 'biceps', sets: 2 },
          { region: 'legs', sets: 10 },
          { region: 'shoulders', sets: 6 },
          { region: 'core', sets: 6 },
        ],
      }),
      { kind: 'critique' },
    )
    if (r.kind !== 'critique') throw new Error('wrong kind')
    expect(r.critique.observations.join(' ').toLowerCase()).toContain('push')
  })

  it('handles an empty history gracefully', async () => {
    const r = await mockCoachProvider.respond(
      summary({ totalWorkouts: 0, weeks: [], regionSets: [], exercises: [] }),
      { kind: 'critique' },
    )
    if (r.kind !== 'critique') throw new Error('wrong kind')
    expect(r.critique.observations[0]!.toLowerCase()).toContain('no sessions')
  })
})

describe('mockCoachProvider — plan', () => {
  it('continues recent lifts, split into sessions', async () => {
    const r = await mockCoachProvider.respond(
      summary({
        exercises: [
          ex({ name: 'Barbell Bench Press', region: 'chest', recentTopSetKg: 90 }),
          ex({ name: 'Barbell Back Squat', region: 'legs', recentTopSetKg: 140 }),
        ],
      }),
      { kind: 'plan', goal: '' },
    )
    if (r.kind !== 'plan') throw new Error('wrong kind')
    expect(r.plan.sessions.length).toBeGreaterThan(0)
    const allNames = r.plan.sessions.flatMap((s) => s.exercises.map((e) => e.name))
    expect(allNames).toContain('Barbell Bench Press')
    // Weight is surfaced in the user's unit (90kg ≈ 198 lb).
    const bench = r.plan.sessions
      .flatMap((s) => s.exercises)
      .find((e) => e.name === 'Barbell Bench Press')!
    expect(bench.weight).toBeCloseTo(198, 0)
  })

  it('proposes a starter week when there is no history', async () => {
    const r = await mockCoachProvider.respond(
      summary({ totalWorkouts: 0, exercises: [] }),
      { kind: 'plan', goal: '' },
    )
    if (r.kind !== 'plan') throw new Error('wrong kind')
    expect(r.plan.sessions.length).toBe(2)
    expect(r.plan.overview.toLowerCase()).toContain('full-body')
    // New plan shape: single week (no program), every exercise flags progression.
    expect(r.plan.programName).toBeNull()
    expect(r.plan.durationWeeks).toBeNull()
    const allEx = r.plan.sessions.flatMap((s) => s.exercises)
    expect(allEx.every((e) => typeof e.autoProgress === 'boolean')).toBe(true)
  })
})

describe('mockCoachProvider — questions', () => {
  it('answers a volume question from the summary', async () => {
    const r = await mockCoachProvider.respond(summary(), {
      kind: 'ask',
      question: 'How much volume have I done?',
    })
    if (r.kind !== 'answer') throw new Error('wrong kind')
    expect(r.text).toMatch(/\d+ working sets/)
  })

  it('is honest when there is no data', async () => {
    const r = await mockCoachProvider.respond(summary({ totalWorkouts: 0 }), {
      kind: 'ask',
      question: 'what should I do',
    })
    if (r.kind !== 'answer') throw new Error('wrong kind')
    expect(r.text.toLowerCase()).toContain('no training history')
  })
})
