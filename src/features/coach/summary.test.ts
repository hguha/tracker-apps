import { describe, expect, it } from 'vitest'
import {
  buildCoachSummary,
  SUMMARY_VERSION,
  type SummaryInput,
  type SummarySession,
} from './summary'

function session(
  weekOffset: number,
  exercises: SummarySession['exercises'],
): SummarySession {
  return { weekOffset, exercises }
}

function bench(sets: { weightKg: number; reps: number; rpe?: number }[]) {
  return {
    exerciseId: 'barbell_bench_press',
    name: 'Barbell Bench Press',
    region: 'chest' as const,
    pattern: 'horizontal_push' as const,
    equipment: 'barbell' as const,
    isCardio: false,
    sets: sets.map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe ?? null,
      durationSeconds: null,
      distanceM: null,
    })),
  }
}

function input(sessions: SummarySession[]): SummaryInput {
  return {
    unitWeight: 'lb',
    unitLength: 'in',
    weeklyWorkoutGoal: 4,
    bodyweightKg: null,
    heightCm: null,
    trainingGoal: '',
    sessions,
  }
}

describe('buildCoachSummary — aggregation', () => {
  it('rolls up workouts, sets, and volume per week', () => {
    const s = buildCoachSummary(
      input([
        session(0, [
          bench([
            { weightKg: 100, reps: 10 },
            { weightKg: 100, reps: 10 },
          ]),
        ]),
        session(-1, [bench([{ weightKg: 95, reps: 10 }])]),
      ]),
    )
    expect(s.totalWorkouts).toBe(2)
    // Most recent week first.
    expect(s.weeks[0]!.weekOffset).toBe(0)
    expect(s.weeks[0]!.sets).toBe(2)
    expect(s.weeks[0]!.volumeKg).toBe(2000)
    expect(s.weeks[1]!.weekOffset).toBe(-1)
  })

  it('summarizes an exercise with e1RM, top set, rep range, and recency', () => {
    const s = buildCoachSummary(
      input([
        session(-2, [bench([{ weightKg: 90, reps: 8 }])]),
        session(0, [
          bench([
            { weightKg: 100, reps: 5 },
            { weightKg: 100, reps: 5 },
          ]),
        ]),
      ]),
    )
    const ex = s.exercises.find((e) => e.name === 'Barbell Bench Press')!
    expect(ex.sessions).toBe(2)
    expect(ex.totalSets).toBe(3)
    expect(ex.repRange).toEqual([5, 8])
    // Most recent session (week 0) heaviest set.
    expect(ex.recentTopSetKg).toBe(100)
    expect(ex.lastWeekOffset).toBe(0)
    // Best e1RM: 100×5 (~116.7) beats 90×8 (~114).
    expect(ex.bestE1rmKg).toBeCloseTo(116.7, 0)
  })

  it('counts working sets per region, most-trained first', () => {
    const squat = {
      exerciseId: 'barbell_back_squat',
      name: 'Barbell Back Squat',
      region: 'legs' as const,
      pattern: 'squat' as const,
      equipment: 'barbell' as const,
      isCardio: false,
      sets: [
        { weightKg: 140, reps: 5, rpe: null, durationSeconds: null, distanceM: null },
        { weightKg: 140, reps: 5, rpe: null, durationSeconds: null, distanceM: null },
        { weightKg: 140, reps: 5, rpe: null, durationSeconds: null, distanceM: null },
      ],
    }
    const s = buildCoachSummary(
      input([session(0, [squat, bench([{ weightKg: 100, reps: 10 }])])]),
    )
    expect(s.regionSets[0]).toEqual({ region: 'legs', sets: 3 })
    expect(s.regionSets[1]).toEqual({ region: 'chest', sets: 1 })
  })

  it('handles an empty history without throwing', () => {
    const s = buildCoachSummary(input([]))
    expect(s.totalWorkouts).toBe(0)
    expect(s.exercises).toEqual([])
    expect(s.weeks).toEqual([])
  })

  it('leaves cardio out of tonnage but keeps it as an exercise', () => {
    const run = {
      exerciseId: 'treadmill_run',
      name: 'Treadmill Run',
      region: 'cardio' as const,
      pattern: 'cardio' as const,
      equipment: 'other' as const,
      isCardio: true,
      sets: [
        {
          weightKg: null,
          reps: null,
          rpe: null,
          durationSeconds: 1800,
          distanceM: 5000,
        },
      ],
    }
    const s = buildCoachSummary(input([session(0, [run])]))
    expect(s.weeks[0]!.volumeKg).toBe(0)
    expect(s.exercises.find((e) => e.name === 'Treadmill Run')).toBeDefined()
  })
})

describe('buildCoachSummary — privacy contract (§2, §13)', () => {
  it('serializes to JSON with no identifying fields anywhere', () => {
    const s = buildCoachSummary(
      input([session(0, [bench([{ weightKg: 100, reps: 10 }])])]),
    )
    const json = JSON.stringify(s)
    // No names/emails/notes and — critically — no absolute dates or timestamps.
    for (const forbidden of ['name":"You', 'email', 'note', 'startedAt', 'createdAt']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    // Dates are week offsets only — no 13-digit epoch ms or ISO strings.
    expect(json).not.toMatch(/\d{13}/)
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('carries the version so a server prompt can branch on shape', () => {
    expect(buildCoachSummary(input([])).version).toBe(SUMMARY_VERSION)
  })

  it('keeps exercise names — they are vocabulary, not identity', () => {
    const s = buildCoachSummary(
      input([session(0, [bench([{ weightKg: 100, reps: 10 }])])]),
    )
    expect(s.exercises[0]!.name).toBe('Barbell Bench Press')
  })
})
