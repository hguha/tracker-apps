// The coach's tool registry: typed function-calling tools the model may invoke.
//
// RETRIEVAL tools run locally against IndexedDB and return structured JSON to the
// model (that's how the coach answers open-ended history questions without a vector
// store — precise, and data stays local until a specific lookup needs it). ACTION
// tools are terminal: instead of returning data, they surface an interactive card
// (a plan, a template edit, accessory suggestions) for the user to accept.
//
// Declarations are the single source of truth and are sent to the edge each turn,
// so the model and the client can never disagree about the available tools.

import * as repo from '@/data/repository'
import { buildExerciseResolver } from '@/data/resolveExerciseName'
import { computeTrainingPatterns } from '@/data/patterns'
import { DAY_MS } from '@/lib/dates'
import {
  bestEffectiveOneRepMaxKg,
  effectiveTopSetKg,
  volumeLoadKg,
} from '@/lib/metrics'
import { displayWeight, displayWeightOrNull } from '@/lib/units'
import { EQUIPMENT, type Equipment, type Exercise, type WeightUnit } from '@/domain/types'
import type {
  CoachAction,
  PlanExercise,
  PlanSession,
  ToolDeclaration,
} from './types'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10)

async function unit(): Promise<WeightUnit> {
  return (await repo.getProfile()).unitWeight
}

async function resolveExercise(
  name: string,
): Promise<{ exercise: Exercise; equipment: Equipment } | null> {
  const library = await repo.listExercises()
  const resolver = buildExerciseResolver(library)
  const res = resolver(name)
  if (!res) return null
  const exercise = library.find((e) => e.id === res.exerciseId)
  if (!exercise) return null
  return { exercise, equipment: res.equipment }
}

// ───────────────────────────── parameter schemas ────────────────────────────────

const EXERCISE_PARAM = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Movement name only, e.g. "Bench Press".' },
    sets: { type: 'integer' },
    repLow: { type: 'integer' },
    repHigh: { type: 'integer' },
    weight: { type: 'number', nullable: true, description: "Working weight in the user's unit; null to seed from history." },
    equipment: { type: 'string', nullable: true, enum: [...EQUIPMENT] },
    note: { type: 'string' },
    autoProgress: { type: 'boolean' },
  },
  required: ['name', 'sets', 'repLow', 'repHigh', 'note', 'autoProgress'],
}

const SESSION_PARAM = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Session name, e.g. "Push A".' },
    exercises: { type: 'array', items: EXERCISE_PARAM },
  },
  required: ['name', 'exercises'],
}

// ───────────────────────────── argument coercion ────────────────────────────────

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function coercePlanExercise(raw: Record<string, unknown>): PlanExercise {
  const repLow = num(raw.repLow, 8)
  const repHigh = num(raw.repHigh, repLow)
  return {
    name: String(raw.name ?? '').trim(),
    sets: Math.max(1, Math.round(num(raw.sets, 3))),
    repLow,
    repHigh: Math.max(repLow, repHigh),
    weight: typeof raw.weight === 'number' ? raw.weight : null,
    equipment: (EQUIPMENT as readonly string[]).includes(raw.equipment as string)
      ? (raw.equipment as Equipment)
      : null,
    note: String(raw.note ?? ''),
    autoProgress: raw.autoProgress === true,
  }
}

function coerceSession(raw: Record<string, unknown>): PlanSession {
  const exercises = Array.isArray(raw.exercises) ? raw.exercises : []
  return {
    name: String(raw.name ?? 'Session').trim() || 'Session',
    exercises: exercises
      .map((e) => coercePlanExercise(e as Record<string, unknown>))
      .filter((e) => e.name !== ''),
  }
}

// ───────────────────────────── retrieval tools ──────────────────────────────────

type Args = Record<string, unknown>

interface RetrievalTool {
  kind: 'retrieval'
  declaration: ToolDeclaration
  label: (args: Args) => string
  execute: (args: Args) => Promise<unknown>
}

interface ActionTool {
  kind: 'action'
  declaration: ToolDeclaration
  toAction: (args: Args) => Promise<CoachAction | null>
}

type ToolSpec = RetrievalTool | ActionTool

const getExerciseHistory: RetrievalTool = {
  kind: 'retrieval',
  label: (a) => `Looking up ${String(a.exercise ?? 'that lift')} history`,
  declaration: {
    name: 'getExerciseHistory',
    description:
      "Recent logged sessions for one movement (dates, sets, weights, best estimated 1RM). Use for questions about how a specific lift has gone.",
    parameters: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Movement name, e.g. "Squat".' },
        limit: { type: 'integer', description: 'Max sessions (default 6).' },
      },
      required: ['exercise'],
    },
  },
  execute: async (a) => {
    const resolved = await resolveExercise(String(a.exercise ?? ''))
    if (!resolved) return { error: `No exercise matches "${a.exercise}".` }
    const { exercise } = resolved
    const u = await unit()
    const limit = Math.max(1, Math.min(20, num(a.limit, 6)))
    const sessions = await repo.completedSessionsForExercise(exercise.id)
    return {
      exercise: exercise.name,
      totalSessions: sessions.length,
      sessions: sessions.slice(0, limit).map((s) => ({
        date: isoDay(s.workout.startedAt),
        equipment: s.workoutExercise.equipment,
        loadMode: s.workoutExercise.loadMode,
        bestE1rm: displayWeightOrNull(
          bestEffectiveOneRepMaxKg(
            s.sets,
            exercise,
            s.workout.bodyweightKg,
            s.workoutExercise.loadMode,
          ),
          u,
        ),
        sets: s.sets.map((set) => ({
          weight: displayWeightOrNull(set.weightKg, u),
          reps: set.reps,
        })),
      })),
    }
  },
}

const getProgress: RetrievalTool = {
  kind: 'retrieval',
  label: (a) => `Charting ${String(a.exercise ?? 'your')} progress`,
  declaration: {
    name: 'getProgress',
    description:
      'Chronological strength trend for one movement: estimated 1RM, top-set weight, and volume per session over time. Use for "how is X trending" / "am I getting stronger".',
    parameters: {
      type: 'object',
      properties: { exercise: { type: 'string' } },
      required: ['exercise'],
    },
  },
  execute: async (a) => {
    const resolved = await resolveExercise(String(a.exercise ?? ''))
    if (!resolved) return { error: `No exercise matches "${a.exercise}".` }
    const { exercise } = resolved
    const u = await unit()
    const sessions = (await repo.completedSessionsForExercise(exercise.id)).sort(
      (x, y) => x.workout.startedAt - y.workout.startedAt,
    )
    return {
      exercise: exercise.name,
      unit: u,
      points: sessions.map((s) => ({
        date: isoDay(s.workout.startedAt),
        e1rm: displayWeightOrNull(
          bestEffectiveOneRepMaxKg(s.sets, exercise, s.workout.bodyweightKg, s.workoutExercise.loadMode),
          u,
        ),
        topSet: displayWeightOrNull(
          effectiveTopSetKg(s.sets, exercise, s.workout.bodyweightKg, s.workoutExercise.loadMode),
          u,
        ),
        volume: Math.round(
          displayWeight(
            volumeLoadKg(s.sets, exercise, s.workout.bodyweightKg, s.workoutExercise.loadMode),
            u,
          ),
        ),
      })),
    }
  },
}

const findWorkouts: RetrievalTool = {
  kind: 'retrieval',
  label: () => 'Searching your workouts',
  declaration: {
    name: 'findWorkouts',
    description:
      'Search past sessions, newest first. Filter by an exercise it must include, how far back to look, and/or a minimum total volume. Use to "find that workout where…".',
    parameters: {
      type: 'object',
      properties: {
        exercise: { type: 'string', nullable: true, description: 'Only sessions containing this movement.' },
        sinceDaysAgo: { type: 'integer', nullable: true },
        minVolumeKg: { type: 'number', nullable: true },
        limit: { type: 'integer', description: 'Default 10.' },
      },
    },
  },
  execute: async (a) => {
    const u = await unit()
    const limit = Math.max(1, Math.min(25, num(a.limit, 10)))
    let resolvedName: string | null = null
    if (typeof a.exercise === 'string' && a.exercise.trim() !== '') {
      resolvedName = (await resolveExercise(a.exercise))?.exercise.name ?? null
    }
    const since =
      typeof a.sinceDaysAgo === 'number'
        ? Date.now() - a.sinceDaysAgo * DAY_MS
        : null
    const minVolume = typeof a.minVolumeKg === 'number' ? a.minVolumeKg : null

    const summaries = (await repo.listFinishedWorkoutSummaries(200)).filter((s) => {
      if (since !== null && s.workout.startedAt < since) return false
      if (minVolume !== null && s.volumeKg < minVolume) return false
      if (resolvedName !== null && !s.exerciseNames.some((n) => n.includes(resolvedName!)))
        return false
      return true
    })

    return {
      matches: summaries.length,
      workouts: summaries.slice(0, limit).map((s) => ({
        date: isoDay(s.workout.startedAt),
        title: s.title,
        volume: displayWeightOrNull(s.volumeKg, u),
        sets: s.setCount,
        exercises: s.exerciseNames,
      })),
    }
  },
}

const listTemplatesTool: RetrievalTool = {
  kind: 'retrieval',
  label: () => 'Reading your templates',
  declaration: {
    name: 'listTemplates',
    description: "The user's saved workout templates with their exercise counts.",
    parameters: { type: 'object', properties: {} },
  },
  execute: async () => {
    const templates = await repo.listTemplates()
    const rows = await Promise.all(
      templates.map(async (t) => ({
        id: t.id,
        name: t.name,
        exercises: (await repo.listTemplateExercises(t.id)).length,
        timesUsed: t.timesUsed,
      })),
    )
    return { templates: rows }
  },
}

const getTemplateTool: RetrievalTool = {
  kind: 'retrieval',
  label: (a) => `Reading "${String(a.name ?? 'template')}"`,
  declaration: {
    name: 'getTemplate',
    description: 'The exercises and per-exercise targets of one saved template, by name.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  execute: async (a) => {
    const u = await unit()
    const name = String(a.name ?? '').trim().toLowerCase()
    const template = (await repo.listTemplates()).find(
      (t) => t.name.toLowerCase() === name,
    )
    if (!template) return { error: `No template named "${a.name}".` }
    const exercises = await repo.listTemplateExercises(template.id)
    const library = await repo.listExercises()
    return {
      id: template.id,
      name: template.name,
      exercises: exercises.map((te) => ({
        name: library.find((e) => e.id === te.exerciseId)?.name ?? te.exerciseId,
        equipment: te.equipment,
        target: repo.describeTemplateTarget(te, u),
      })),
    }
  },
}

const getTrainingPatternsTool: RetrievalTool = {
  kind: 'retrieval',
  label: () => 'Analyzing your training cadence',
  declaration: {
    name: 'getTrainingPatterns',
    description:
      'When the user trains: sessions per week, typical rest days between sessions, and how often they train on each day of the week. Use for "when should I train" / scheduling.',
    parameters: { type: 'object', properties: {} },
  },
  execute: async () => {
    const finished = (await repo.listWorkouts(500)).filter((w) => w.endedAt !== null)
    const p = computeTrainingPatterns(finished)
    return {
      totalSessions: p.totalSessions,
      sessionsPerWeek: p.sessionsPerWeek === null ? null : Math.round(p.sessionsPerWeek * 10) / 10,
      medianRestDays: p.medianRestDays,
      busiestDay: p.busiestDay === null ? null : DAY_NAMES[p.busiestDay],
      byDay: p.dayOfWeekCounts.map((count, i) => ({ day: DAY_NAMES[i], count })),
      byHour: p.hourCounts,
    }
  },
}

const getBodyMetricsTool: RetrievalTool = {
  kind: 'retrieval',
  label: (a) => `Reading ${String(a.metric ?? 'body')} history`,
  declaration: {
    name: 'getBodyMetrics',
    description:
      'Time series for a tracked body metric (default "bodyweight"): recent values with dates. Use for bodyweight trends etc.',
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', description: 'Metric id, e.g. "bodyweight".' },
        limit: { type: 'integer' },
      },
    },
  },
  execute: async (a) => {
    const metric = String(a.metric ?? 'bodyweight')
    const limit = Math.max(1, Math.min(60, num(a.limit, 20)))
    const entries = await repo.listMetricEntries(metric, limit)
    const u = await unit()
    return {
      metric,
      entries: entries.map((e) => ({
        date: isoDay(e.measuredAt),
        value: metric === 'bodyweight' ? displayWeightOrNull(e.value, u) : e.value,
      })),
    }
  },
}

// ───────────────────────────── action tools ─────────────────────────────────────

const proposePlan: ActionTool = {
  kind: 'action',
  declaration: {
    name: 'proposePlan',
    description:
      'Surface a workout plan for the user to review and save as templates. Use when you have enough detail to commit to a concrete plan — otherwise ask a clarifying question in text first.',
    parameters: {
      type: 'object',
      properties: {
        overview: { type: 'string' },
        programName: { type: 'string', nullable: true },
        durationWeeks: { type: 'integer', nullable: true },
        sessions: { type: 'array', items: SESSION_PARAM },
      },
      required: ['overview', 'sessions'],
    },
  },
  toAction: async (a) => {
    const sessions = Array.isArray(a.sessions) ? a.sessions : []
    return {
      kind: 'plan',
      plan: {
        overview: String(a.overview ?? ''),
        programName: typeof a.programName === 'string' ? a.programName : null,
        durationWeeks: typeof a.durationWeeks === 'number' ? a.durationWeeks : null,
        sessions: sessions.map((s) => coerceSession(s as Record<string, unknown>)),
      },
    }
  },
}

const proposeTemplateUpdate: ActionTool = {
  kind: 'action',
  declaration: {
    name: 'proposeTemplateUpdate',
    description:
      'Surface changes to an EXISTING template (by name) for the user to review and apply. The session you provide fully replaces that template\'s exercises. Use for "make my Push day heavier" etc.',
    parameters: {
      type: 'object',
      properties: {
        templateName: { type: 'string' },
        note: { type: 'string', description: 'One line on what changed and why.' },
        session: SESSION_PARAM,
      },
      required: ['templateName', 'note', 'session'],
    },
  },
  toAction: async (a) => {
    const name = String(a.templateName ?? '').trim().toLowerCase()
    const template = (await repo.listTemplates()).find(
      (t) => t.name.toLowerCase() === name,
    )
    if (!template) return null
    return {
      kind: 'templateUpdate',
      templateId: template.id,
      templateName: template.name,
      note: String(a.note ?? ''),
      session: coerceSession((a.session ?? {}) as Record<string, unknown>),
    }
  },
}

const suggestAccessories: ActionTool = {
  kind: 'action',
  declaration: {
    name: 'suggestAccessories',
    description:
      'Suggest accessory exercises to add to the CURRENT workout in progress. Only use mid-workout. The user can add any of them to the live session.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string' },
        exercises: { type: 'array', items: EXERCISE_PARAM },
      },
      required: ['note', 'exercises'],
    },
  },
  toAction: async (a) => {
    const exercises = Array.isArray(a.exercises) ? a.exercises : []
    return {
      kind: 'accessories',
      note: String(a.note ?? ''),
      exercises: exercises
        .map((e) => coercePlanExercise(e as Record<string, unknown>))
        .filter((e) => e.name !== ''),
    }
  },
}

// ───────────────────────────── registry ─────────────────────────────────────────

const TOOLS: Record<string, ToolSpec> = {
  getExerciseHistory,
  getProgress,
  findWorkouts,
  listTemplates: listTemplatesTool,
  getTemplate: getTemplateTool,
  getTrainingPatterns: getTrainingPatternsTool,
  getBodyMetrics: getBodyMetricsTool,
  proposePlan,
  proposeTemplateUpdate,
  suggestAccessories,
}

export const TOOL_DECLARATIONS: ToolDeclaration[] = Object.values(TOOLS).map(
  (t) => t.declaration,
)

export function isActionTool(name: string): boolean {
  return TOOLS[name]?.kind === 'action'
}

// Status-chip label for a retrieval tool call, or a generic fallback.
export function toolLabel(name: string, args: Args): string {
  const tool = TOOLS[name]
  return tool?.kind === 'retrieval' ? tool.label(args) : 'Working'
}

export async function executeRetrievalTool(name: string, args: Args): Promise<unknown> {
  const tool = TOOLS[name]
  if (!tool || tool.kind !== 'retrieval') return { error: `Unknown tool "${name}".` }
  try {
    return await tool.execute(args)
  } catch {
    return { error: `Tool "${name}" failed.` }
  }
}

export async function toolToAction(name: string, args: Args): Promise<CoachAction | null> {
  const tool = TOOLS[name]
  if (!tool || tool.kind !== 'action') return null
  return tool.toAction(args)
}

// Compact preview of a proposed load, for chat cards. PlanExercise.weight is
// already in the user's unit, so it's appended directly (not converted from kg).
export function describePlanExerciseLoad(e: PlanExercise, weightUnit: WeightUnit): string {
  const reps = e.repLow === e.repHigh ? `${e.repLow}` : `${e.repLow}-${e.repHigh}`
  const weight = e.weight !== null ? ` · ${e.weight} ${weightUnit}` : ''
  return `${e.sets} × ${reps}${weight}`
}
