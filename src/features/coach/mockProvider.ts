/**
 * A deterministic, offline coach (§13).
 *
 * Not an LLM: it reads the same de-identified summary the real provider will and
 * applies plain heuristics — balance, staleness, adherence, rep-range spread —
 * to produce a genuine critique and a sensible next-week plan. This exists so
 * the entire coach interaction (critique → plan → editable templates → save) is
 * real, testable, and useful *before* any API key exists, and it's the fallback
 * when the network or the LLM is unavailable.
 *
 * Pure given its summary — no I/O, no randomness — so its output is unit-tested.
 */

import { REGION_LABELS, type Region } from '@/domain/types'
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

  // Weekly frequency vs the stated goal.
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

  // Balance: which core regions are untrained or clearly under-trained.
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

  // Push/pull balance — a common imbalance worth surfacing.
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

  // Stale lifts: trained earlier in the window but not recently.
  const stale = summary.exercises
    .filter((e) => e.lastWeekOffset <= -3 && e.sessions >= 2)
    .slice(0, 2)
  if (stale.length > 0) {
    observations.push(
      `${stale.map((e) => e.name).join(' and ')} ${stale.length > 1 ? 'have' : 'has'} not been trained in 3+ weeks.`,
    )
    suggestions.push(`Cycle ${stale[0]!.name} back in if it's still a goal.`)
  }

  // A strength highlight, so the critique isn't only corrective.
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

/**
 * A parsed reading of a free-text goal. The offline coach can't reason like the
 * LLM, so it extracts the few things that change the shape of a plan — which
 * split, what emphasis, how long — and builds toward *that* rather than toward
 * whatever the user already does most (the "reinforces the imbalance" bug).
 */
interface GoalIntent {
  /** Named split the user asked for, or null to continue their own training. */
  split: 'lower' | 'upper' | 'push_pull_legs' | 'full_body' | null
  /** Rep emphasis: strength (low reps, compounds) vs hypertrophy (moderate). */
  emphasis: 'strength' | 'hypertrophy' | null
  /** Program length in weeks if the goal named one (e.g. "12-week"), else null. */
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

/** The library-backed movement each session slot draws from, by region. A named
 *  split builds from these so the plan matches the goal even when the user's own
 *  history doesn't cover those regions. Names match the seeded library. */
const MOVEMENTS: Record<Exclude<Region, 'cardio'>, string[]> = {
  legs: [
    'Barbell Back Squat',
    'Romanian Deadlift',
    'Leg Press',
    'Lying Leg Curl',
    'Leg Extension',
  ],
  chest: ['Barbell Bench Press', 'Incline Dumbbell Bench Press', 'Cable Fly'],
  back: ['Barbell Row', 'Lat Pulldown', 'Seated Cable Row'],
  shoulders: ['Overhead Press', 'Dumbbell Lateral Raise', 'Face Pull'],
  biceps: ['Barbell Curl', 'Dumbbell Curl'],
  triceps: ['Cable Triceps Pushdown', 'Overhead Cable Triceps Extension'],
  core: ['Plank', 'Hanging Leg Raise'],
}

/**
 * Build a plan toward a stated goal (offline). When the goal names a split, the
 * plan is built from that split's canonical movements — seeded at the user's
 * recent weight where they've done a lift, null otherwise — rather than
 * replaying whatever they train most. A blank goal falls back to continuing
 * their own recent training, split upper/lower.
 */
function plan(summary: CoachSummary, goal = ''): CoachPlan {
  const unit = summary.unitWeight
  const toDisplay = (kg: number | null) => displayWeightOrNull(kg, unit)

  // The user's recent top set per exercise name, to seed weights when the plan
  // reuses a lift they've actually done.
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

  // Turn a movement name into a planned exercise, seeding from history if present.
  const build = (name: string, isCompound: boolean) => {
    const seen = recentByName.get(name.toLowerCase())
    return {
      name,
      sets: isCompound && intent.emphasis === 'strength' ? 4 : 3,
      repLow: isCompound ? repLow : Math.max(repLow, 8),
      repHigh: isCompound ? repHigh : Math.max(repHigh, 12),
      weight: seen ? toDisplay(seen.recentTopSetKg) : null,
      note: seen
        ? 'Seeded at your recent working weight; progress from there.'
        : 'New to your log — start conservative and build up.',
      // Compounds progress; isolation holds its rep range.
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

  // A goal with no split, emphasis, or duration is uninformative — continue the
  // user's own recent training instead of inventing a split.
  if (intent.split === null && intent.emphasis === null && intent.weeks === null) {
    return continuationPlan(summary)
  }

  // A goal that named an emphasis or duration but no split gets a balanced
  // upper/lower split built toward that emphasis (rather than continuation).
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
            build('Romanian Deadlift', true),
            build('Lying Leg Curl', false),
            build('Leg Press', true),
            build('Plank', false),
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
            build('Barbell Back Squat', true),
            build('Barbell Bench Press', true),
            build('Barbell Row', true),
          ],
        },
        {
          name: 'Full Body B',
          exercises: [
            build('Romanian Deadlift', true),
            build('Overhead Press', true),
            build('Lat Pulldown', true),
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

  // A named duration makes it a program; progression carries the weekly load.
  if (intent.weeks) {
    programName =
      intent.emphasis === 'strength'
        ? `${intent.weeks}-Week Strength Block`
        : `${intent.weeks}-Week Program`
    overview += ` Run it for ${intent.weeks} weeks, adding weight as the auto-progression lifts clear their rep range.`
  }

  return { overview, programName, durationWeeks: intent.weeks, sessions }
}

/** The blank-goal path: continue the user's recent lifts, split upper/lower. */
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

/** A balanced beginner week, used only when there's no history to build on. */
const STARTER_SESSIONS: PlanSession[] = [
  {
    name: 'Full Body A',
    exercises: [
      {
        name: 'Barbell Back Squat',
        sets: 3,
        repLow: 5,
        repHigh: 8,
        weight: null,
        autoProgress: true,
        note: 'Start light and add weight each session.',
      },
      {
        name: 'Barbell Bench Press',
        sets: 3,
        repLow: 5,
        repHigh: 8,
        weight: null,
        autoProgress: true,
        note: 'Focus on clean, controlled reps.',
      },
      {
        name: 'Barbell Row',
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
        sets: 2,
        repLow: 5,
        repHigh: 5,
        weight: null,
        autoProgress: true,
        note: 'Keep it crisp — stop when form slips.',
      },
      {
        name: 'Overhead Press',
        sets: 3,
        repLow: 5,
        repHigh: 8,
        weight: null,
        autoProgress: true,
        note: 'Vertical pressing for the shoulders.',
      },
      {
        name: 'Lat Pulldown',
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

/** Answer a freeform question from the summary — heuristic, honest about limits. */
function answer(summary: CoachSummary, question: string): string {
  const q = question.toLowerCase()

  if (summary.totalWorkouts === 0) {
    return "There's no training history yet, so I can't answer from your data. Log a few sessions and ask again."
  }

  // A few recognizable intents; otherwise a grounded fallback.
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

/** Whether an Ask question is really asking for a workout/program to be built,
 *  so the offline coach can answer with a plan instead of prose. */
function looksLikePlanRequest(question: string): boolean {
  const q = question.toLowerCase()
  return /\b(give me|make me|build|design|create|plan|program|split|routine|workout|day|week)\b/.test(
    q,
  )
}

/** A warm 1–2 sentence note for the Home greeting, grounded in the numbers. */
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

/**
 * The offline coach. Available everywhere; used until a real LLM provider is
 * wired, and as the fallback when one is unreachable.
 */
export const mockCoachProvider: CoachProvider = {
  name: 'FitNote Coach (offline)',
  async respond(summary: CoachSummary, request: CoachRequest): Promise<CoachResponse> {
    // A per-request goal wins; otherwise fall back to the standing profile goal
    // so even a bare "Plan" builds toward what the user is training for.
    switch (request.kind) {
      case 'critique':
        return { kind: 'critique', critique: critique(summary) }
      case 'plan':
        return {
          kind: 'plan',
          plan: plan(summary, request.goal || summary.trainingGoal),
        }
      case 'ask': {
        // If the question reads like a plan request, answer with a plan built
        // toward it — matching the live provider's unified Ask behavior.
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
