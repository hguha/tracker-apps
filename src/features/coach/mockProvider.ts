// Deterministic offline coach (§13): heuristics over the de-identified summary,
// used before any API key exists and as the fallback when the LLM is unreachable.

import { REGION_LABELS, type Equipment, type Region } from '@/domain/types'
import { displayWeight, displayWeightOrNull } from '@/lib/units'
import type { CoachSummary, ExerciseAgg } from './summary'
import type {
  CoachCritique,
  CoachPlan,
  CoachProvider,
  CoachRequest,
  CoachResponse,
  PlanSession,
} from './types'

/** Regions a balanced program should touch each week — cardio excluded. */
const CORE_REGIONS: Region[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'legs',
  'core',
]

function critique(summary: CoachSummary): CoachCritique {
  const observations: string[] = []
  const suggestions: string[] = []
  const unit = summary.unitWeight

  if (summary.totalWorkouts === 0) {
    return {
      observations: ['No sessions logged yet in this window.'],
      suggestions: [
        'Log a few workouts and the coach can critique your balance and progression.',
      ],
    }
  }

  const recentWeeks = summary.weeks.filter((w) => w.weekOffset >= -3)
  const avgPerWeek =
    recentWeeks.length > 0
      ? recentWeeks.reduce((s, w) => s + w.workouts, 0) / recentWeeks.length
      : 0
  if (avgPerWeek + 0.25 < summary.weeklyWorkoutGoal) {
    observations.push(
      `You're averaging ${avgPerWeek.toFixed(1)} sessions a week, under your goal of ${summary.weeklyWorkoutGoal}.`,
    )
    suggestions.push('Add one short session a week to close the gap toward your goal.')
  } else {
    observations.push(
      `Frequency is on track — about ${avgPerWeek.toFixed(1)} sessions a week.`,
    )
  }

  const setsByRegion = new Map<Region, number>(
    summary.regionSets.map((r) => [r.region, r.sets]),
  )
  const untrained = CORE_REGIONS.filter((r) => (setsByRegion.get(r) ?? 0) === 0)
  if (untrained.length > 0) {
    observations.push(
      `No direct work logged for ${untrained.map((r) => REGION_LABELS[r]).join(', ')}.`,
    )
    suggestions.push(
      `Add an exercise for ${REGION_LABELS[untrained[0]!]} to round out the week.`,
    )
  }

  const push = (setsByRegion.get('chest') ?? 0) + (setsByRegion.get('triceps') ?? 0)
  const pull = (setsByRegion.get('back') ?? 0) + (setsByRegion.get('biceps') ?? 0)
  if (push > 0 && pull > 0) {
    const ratio = push / pull
    if (ratio > 1.5) {
      observations.push('Your pushing volume is well ahead of your pulling.')
      suggestions.push('Add a row or pulldown to balance push and pull.')
    } else if (ratio < 0.67) {
      observations.push('Your pulling volume is well ahead of your pushing.')
      suggestions.push('Add a press to balance pull and push.')
    }
  }

  const stale = summary.exercises
    .filter((e) => e.lastWeekOffset <= -3 && e.sessions >= 2)
    .slice(0, 2)
  if (stale.length > 0) {
    observations.push(
      `${stale.map((e) => e.name).join(' and ')} ${stale.length > 1 ? 'have' : 'has'} not been trained in 3+ weeks.`,
    )
    suggestions.push(`Cycle ${stale[0]!.name} back in if it's still a goal.`)
  }

  const strongest = summary.exercises
    .filter((e) => e.bestE1rmKg !== null)
    .sort((a, b) => (b.bestE1rmKg ?? 0) - (a.bestE1rmKg ?? 0))[0]
  if (strongest && strongest.bestE1rmKg !== null) {
    const shown = displayWeight(strongest.bestE1rmKg, unit)
    observations.push(
      `Your strongest estimated lift is ${strongest.name} at ~${shown} ${unit}.`,
    )
  }

  if (suggestions.length === 0) {
    suggestions.push('Balance and frequency look solid — keep progressing where you can.')
  }

  return { observations, suggestions }
}

interface GoalIntent {
  split: 'lower' | 'upper' | 'push_pull_legs' | 'full_body' | null
  emphasis: 'strength' | 'hypertrophy' | null
  weeks: number | null
}

function parseGoal(goal: string): GoalIntent {
  const g = goal.toLowerCase()
  const weekMatch = g.match(/(\d+)\s*[- ]?\s*week/)
  const weeks = weekMatch ? Math.min(52, Math.max(2, Number(weekMatch[1]))) : null

  let split: GoalIntent['split'] = null
  if (/\b(ppl|push[/ ]?pull[/ ]?legs)\b/.test(g)) split = 'push_pull_legs'
  else if (/\b(lower|legs?|leg day|glute|quad|hamstring)\b/.test(g)) split = 'lower'
  else if (/\bupper\b/.test(g)) split = 'upper'
  else if (/\b(full[- ]?body|total body)\b/.test(g)) split = 'full_body'

  let emphasis: GoalIntent['emphasis'] = null
  if (/\b(strength|powerlifting|1rm|heavy|power)\b/.test(g)) emphasis = 'strength'
  else if (/\b(hypertrophy|muscle|size|bodybuilding|mass|bigger|tone)\b/.test(g))
    emphasis = 'hypertrophy'

  return { split, emphasis, weeks }
}

// Base movement names plus how each is loaded, matching the library's own model —
// the name alone can't say "cable", and guessing it produced "Barbell Face Pull".
interface Suggestion {
  name: string
  equipment: Equipment
}

const MOVEMENTS: Record<Exclude<Region, 'cardio'>, Suggestion[]> = {
  legs: [
    { name: 'Back Squat', equipment: 'barbell' },
    { name: 'Romanian Deadlift', equipment: 'barbell' },
    { name: 'Leg Press', equipment: 'machine' },
    { name: 'Lying Leg Curl', equipment: 'machine' },
    { name: 'Leg Extension', equipment: 'machine' },
  ],
  chest: [
    { name: 'Bench Press', equipment: 'barbell' },
    { name: 'Incline Bench Press', equipment: 'dumbbell' },
    { name: 'Chest Fly', equipment: 'cable' },
  ],
  back: [
    { name: 'Row', equipment: 'barbell' },
    { name: 'Lat Pulldown', equipment: 'cable' },
    { name: 'Seated Row', equipment: 'cable' },
  ],
  shoulders: [
    { name: 'Overhead Press', equipment: 'barbell' },
    { name: 'Lateral Raise', equipment: 'dumbbell' },
    { name: 'Face Pull', equipment: 'cable' },
  ],
  biceps: [
    { name: 'Biceps Curl', equipment: 'barbell' },
    { name: 'Hammer Curl', equipment: 'dumbbell' },
  ],
  triceps: [
    { name: 'Triceps Pushdown', equipment: 'cable' },
    { name: 'Overhead Triceps Extension', equipment: 'cable' },
  ],
  core: [
    { name: 'Plank', equipment: 'bodyweight' },
    { name: 'Hanging Leg Raise', equipment: 'bodyweight' },
  ],
}

function plan(summary: CoachSummary, goal = ''): CoachPlan {
  const unit = summary.unitWeight
  const toDisplay = (kg: number | null) => displayWeightOrNull(kg, unit)

  const recentByName = new Map<string, ExerciseAgg>()
  for (const e of summary.exercises) recentByName.set(e.name.toLowerCase(), e)

  const intent = parseGoal(goal)
  const strengthReps: [number, number] = [4, 6]
  const hypertrophyReps: [number, number] = [8, 12]
  const [repLow, repHigh] =
    intent.emphasis === 'strength'
      ? strengthReps
      : intent.emphasis === 'hypertrophy'
        ? hypertrophyReps
        : [6, 10]

  const build = ({ name, equipment }: Suggestion, isCompound: boolean) => {
    const seen = recentByName.get(name.toLowerCase())
    return {
      name,
      equipment,
      sets: isCompound && intent.emphasis === 'strength' ? 4 : 3,
      repLow: isCompound ? repLow : Math.max(repLow, 8),
      repHigh: isCompound ? repHigh : Math.max(repHigh, 12),
      weight: seen ? toDisplay(seen.recentTopSetKg) : null,
      note: seen
        ? 'Seeded at your recent working weight; progress from there.'
        : 'New to your log — start conservative and build up.',
      autoProgress: isCompound,
    }
  }

  const sessionFromRegions = (
    name: string,
    regions: Exclude<Region, 'cardio'>[],
    perRegion: number,
    compoundRegions: Set<Region>,
  ): PlanSession => ({
    name,
    exercises: regions.flatMap((r) =>
      MOVEMENTS[r]
        .slice(0, perRegion)
        .map((m, i) => build(m, compoundRegions.has(r) && i === 0)),
    ),
  })

  // An uninformative goal continues the user's own training rather than inventing a split.
  if (intent.split === null && intent.emphasis === null && intent.weeks === null) {
    return continuationPlan(summary)
  }

  const effectiveSplit = intent.split ?? 'upper_lower'

  let sessions: PlanSession[]
  let overview: string
  let programName: string | null = null

  switch (effectiveSplit) {
    case 'lower':
      sessions = [
        sessionFromRegions('Lower A — Quads', ['legs'], 3, new Set(['legs'])),
        {
          name: 'Lower B — Posterior',
          exercises: [
            build({ name: 'Romanian Deadlift', equipment: 'barbell' }, true),
            build({ name: 'Lying Leg Curl', equipment: 'machine' }, false),
            build({ name: 'Leg Press', equipment: 'machine' }, true),
            build({ name: 'Plank', equipment: 'bodyweight' }, false),
          ],
        },
      ]
      overview =
        'A lower-body focus, as asked — two leg days built around squat and hinge patterns with quad and hamstring accessory work.'
      break
    case 'upper':
      sessions = [
        sessionFromRegions(
          'Upper A — Push',
          ['chest', 'shoulders', 'triceps'],
          1,
          new Set(['chest', 'shoulders']),
        ),
        sessionFromRegions('Upper B — Pull', ['back', 'biceps'], 2, new Set(['back'])),
      ]
      overview =
        'An upper-body focus, as asked — a push day and a pull day covering chest, back, shoulders, and arms.'
      break
    case 'push_pull_legs':
      sessions = [
        sessionFromRegions(
          'Push',
          ['chest', 'shoulders', 'triceps'],
          1,
          new Set(['chest', 'shoulders']),
        ),
        sessionFromRegions('Pull', ['back', 'biceps'], 2, new Set(['back'])),
        sessionFromRegions('Legs', ['legs', 'core'], 2, new Set(['legs'])),
      ]
      overview =
        'A classic push / pull / legs split, as asked — each major pattern gets its own day.'
      break
    case 'full_body':
      sessions = [
        {
          name: 'Full Body A',
          exercises: [
            build({ name: 'Back Squat', equipment: 'barbell' }, true),
            build({ name: 'Bench Press', equipment: 'barbell' }, true),
            build({ name: 'Row', equipment: 'barbell' }, true),
          ],
        },
        {
          name: 'Full Body B',
          exercises: [
            build({ name: 'Romanian Deadlift', equipment: 'barbell' }, true),
            build({ name: 'Overhead Press', equipment: 'barbell' }, true),
            build({ name: 'Lat Pulldown', equipment: 'cable' }, true),
          ],
        },
      ]
      overview =
        'A full-body split, as asked — two balanced sessions hitting every pattern.'
      break
    case 'upper_lower':
    default:
      sessions = [
        sessionFromRegions(
          'Upper',
          ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
          1,
          new Set(['chest', 'back', 'shoulders']),
        ),
        sessionFromRegions('Lower', ['legs', 'core'], 2, new Set(['legs'])),
      ]
      overview =
        intent.emphasis === 'strength'
          ? 'A strength-focused upper/lower split — heavy compounds up front, moderate accessories.'
          : 'A balanced upper/lower split built toward your goal.'
      break
  }

  if (intent.weeks) {
    programName =
      intent.emphasis === 'strength'
        ? `${intent.weeks}-Week Strength Block`
        : `${intent.weeks}-Week Program`
    overview += ` Run it for ${intent.weeks} weeks, adding weight as the auto-progression lifts clear their rep range.`
  }

  return { overview, programName, durationWeeks: intent.weeks, sessions }
}

function continuationPlan(summary: CoachSummary): CoachPlan {
  const unit = summary.unitWeight
  const toDisplay = (kg: number | null) => displayWeightOrNull(kg, unit)

  if (summary.exercises.length === 0) {
    return {
      overview:
        'A simple full-body week to start building a history the coach can learn from.',
      programName: null,
      durationWeeks: null,
      sessions: STARTER_SESSIONS,
    }
  }

  const active = summary.exercises.filter((e) => e.lastWeekOffset >= -3)
  const byRegion = new Map<Region, ExerciseAgg[]>()
  for (const e of active) {
    if (!e.region || e.region === 'cardio') continue
    const list = byRegion.get(e.region) ?? []
    list.push(e)
    byRegion.set(e.region, list)
  }

  const planned = (e: ExerciseAgg) => ({
    name: e.name,
    // Carry through how they actually did it, rather than making the resolver guess.
    equipment: e.equipment,
    sets: 3,
    repLow: e.repRange ? e.repRange[0] : 8,
    repHigh: e.repRange ? e.repRange[1] : 12,
    weight: toDisplay(e.recentTopSetKg),
    note:
      e.lastWeekOffset <= -2
        ? 'Been a couple weeks — ease back to your recent working weight.'
        : 'Continue at your recent working weight; add reps toward the top of the range.',
    autoProgress: (e.repRange ? e.repRange[0] : 8) <= 6,
  })

  const upperRegions: Region[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps']
  const lowerRegions: Region[] = ['legs', 'core']

  const pick = (regions: Region[], max: number) => {
    const picks: ReturnType<typeof planned>[] = []
    for (const region of regions) {
      const best = byRegion.get(region)?.[0]
      if (best) picks.push(planned(best))
      if (picks.length >= max) break
    }
    return picks
  }

  const sessions: PlanSession[] = []
  const upper = pick(upperRegions, 4)
  if (upper.length > 0) sessions.push({ name: 'Upper', exercises: upper })
  const lower = pick(lowerRegions, 4)
  if (lower.length > 0) sessions.push({ name: 'Lower', exercises: lower })

  if (sessions.length === 0) {
    sessions.push({ name: 'Full Body', exercises: active.slice(0, 5).map(planned) })
  }

  return {
    overview:
      'Next week continues your recent lifts at their working weights, split upper/lower. Edit anything before saving.',
    programName: null,
    durationWeeks: null,
    sessions,
  }
}

const STARTER_SESSIONS: PlanSession[] = [
  {
    name: 'Full Body A',
    exercises: [
      {
        name: 'Back Squat',
        equipment: 'barbell',
        sets: 3,
        repLow: 5,
        repHigh: 8,
        weight: null,
        autoProgress: true,
        note: 'Start light and add weight each session.',
      },
      {
        name: 'Bench Press',
        equipment: 'barbell',
        sets: 3,
        repLow: 5,
        repHigh: 8,
        weight: null,
        autoProgress: true,
        note: 'Focus on clean, controlled reps.',
      },
      {
        name: 'Row',
        equipment: 'barbell',
        sets: 3,
        repLow: 8,
        repHigh: 12,
        weight: null,
        autoProgress: false,
        note: 'Balances the pressing.',
      },
    ],
  },
  {
    name: 'Full Body B',
    exercises: [
      {
        name: 'Deadlift',
        equipment: 'barbell',
        sets: 2,
        repLow: 5,
        repHigh: 5,
        weight: null,
        autoProgress: true,
        note: 'Keep it crisp — stop when form slips.',
      },
      {
        name: 'Overhead Press',
        equipment: 'barbell',
        sets: 3,
        repLow: 5,
        repHigh: 8,
        weight: null,
        autoProgress: true,
        note: 'Vertical pressing for the shoulders.',
      },
      {
        name: 'Lat Pulldown',
        equipment: 'cable',
        sets: 3,
        repLow: 8,
        repHigh: 12,
        weight: null,
        autoProgress: false,
        note: 'Vertical pulling to match.',
      },
    ],
  },
]

function answer(summary: CoachSummary, question: string): string {
  const q = question.toLowerCase()

  if (summary.totalWorkouts === 0) {
    return "There's no training history yet, so I can't answer from your data. Log a few sessions and ask again."
  }

  if (q.includes('volume') || q.includes('how much')) {
    const total = summary.weeks.reduce((s, w) => s + w.sets, 0)
    return `Over the last ${summary.weeksCovered} weeks you've logged ${total} working sets across ${summary.totalWorkouts} sessions.`
  }
  if (q.includes('weak') || q.includes('behind') || q.includes('lagging')) {
    const trained = new Set(summary.regionSets.map((r) => r.region))
    const missing = CORE_REGIONS.filter((r) => !trained.has(r))
    return missing.length > 0
      ? `You've logged no direct work for ${missing.map((r) => REGION_LABELS[r]).join(', ')} — those are the clearest gaps.`
      : 'Every major region has some work; your least-trained is ' +
          `${REGION_LABELS[summary.regionSets[summary.regionSets.length - 1]!.region]}.`
  }

  return (
    `I can see ${summary.totalWorkouts} sessions and ${summary.exercises.length} exercises in your recent history. ` +
    'Ask about your balance, volume, or what to train next, and I can answer from that.'
  )
}

function looksLikePlanRequest(question: string): boolean {
  const q = question.toLowerCase()
  return /\b(give me|make me|build|design|create|plan|program|split|routine|workout|day|week)\b/.test(
    q,
  )
}

function encouragement(summary: CoachSummary): string {
  if (summary.totalWorkouts === 0) {
    return "Every strong log starts with one session — get the first one in and I'll start tracking your progress."
  }

  const thisWeek = summary.weeks.find((w) => w.weekOffset === 0)?.workouts ?? 0
  const goal = summary.weeklyWorkoutGoal
  const topLift = summary.exercises
    .filter((e) => e.bestE1rmKg !== null && e.lastWeekOffset >= -1)
    .sort((a, b) => (b.recentTopSetKg ?? 0) - (a.recentTopSetKg ?? 0))[0]

  if (thisWeek >= goal) {
    return `You've hit your ${goal}-session goal this week — that consistency is exactly what drives progress. Keep it rolling.`
  }
  if (topLift) {
    return `Nice work staying in the gym. Your ${topLift.name} is moving — keep chipping away and the numbers follow.`
  }
  return `${summary.totalWorkouts} sessions logged and counting. Showing up is the hard part, and you're doing it.`
}

export const mockCoachProvider: CoachProvider = {
  name: 'FitNote Coach (offline)',
  async respond(summary: CoachSummary, request: CoachRequest): Promise<CoachResponse> {
    // A per-request goal wins; else fall back to the standing profile goal.
    switch (request.kind) {
      case 'critique':
        return { kind: 'critique', critique: critique(summary) }
      case 'plan':
        return {
          kind: 'plan',
          plan: plan(summary, request.goal || summary.trainingGoal),
        }
      case 'ask': {
        // A plan-like question is answered with a plan, matching the live provider.
        if (looksLikePlanRequest(request.question)) {
          return { kind: 'plan', plan: plan(summary, request.question) }
        }
        return { kind: 'answer', text: answer(summary, request.question) }
      }
      case 'encouragement':
        return { kind: 'answer', text: encouragement(summary) }
    }
  },
  async isAvailable() {
    return true
  },
}
