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
    const shown = Math.round(strongest.bestE1rmKg * (unit === 'lb' ? 2.20462262185 : 1))
    observations.push(
      `Your strongest estimated lift is ${strongest.name} at ~${shown} ${unit}.`,
    )
  }

  if (suggestions.length === 0) {
    suggestions.push('Balance and frequency look solid — keep progressing where you can.')
  }

  return { observations, suggestions }
}

/** Build a next-week plan by continuing recent work and patching the biggest gap. */
function plan(summary: CoachSummary): CoachPlan {
  const unit = summary.unitWeight
  const toDisplay = (kg: number | null): number | null =>
    kg === null ? null : Math.round(kg * (unit === 'lb' ? 2.20462262185 : 1))

  if (summary.exercises.length === 0) {
    // Nothing to continue from — propose a simple, balanced full-body starter.
    return {
      overview:
        'A simple full-body week to start building a history the coach can learn from.',
      programName: null,
      durationWeeks: null,
      sessions: STARTER_SESSIONS,
    }
  }

  // Recent, still-active exercises grouped by region, most-trained first.
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
    // Seed at the recent top set — progression rules take it from there.
    weight: toDisplay(e.recentTopSetKg),
    note:
      e.lastWeekOffset <= -2
        ? 'Been a couple weeks — ease back to your recent working weight.'
        : 'Continue at your recent working weight; add reps toward the top of the range.',
    // Compound-ish work (low rep floor) auto-progresses; higher-rep accessory holds.
    autoProgress: (e.repRange ? e.repRange[0] : 8) <= 6,
  })

  // Two sessions: an upper day and a lower day, filled from what's active,
  // then any untrained core region flagged as a suggested addition.
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

  // Fall back to a single "Full Body" day if the split came up thin.
  if (sessions.length === 0) {
    sessions.push({
      name: 'Full Body',
      exercises: active.slice(0, 5).map(planned),
    })
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
    switch (request.kind) {
      case 'critique':
        return { kind: 'critique', critique: critique(summary) }
      case 'plan':
        return { kind: 'plan', plan: plan(summary) }
      case 'ask':
        return { kind: 'answer', text: answer(summary, request.question) }
      case 'encouragement':
        return { kind: 'answer', text: encouragement(summary) }
    }
  },
  async isAvailable() {
    return true
  },
}
