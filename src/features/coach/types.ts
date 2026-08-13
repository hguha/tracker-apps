// The AI coach interface and its structured output (§13): mock and live provider
// share this contract, and a plan deserializes straight into templates, not prose.

import type { CoachSummary } from './summary'

export interface PlanExercise {
  /** Matched to a library id when materialized. */
  name: string
  sets: number
  repLow: number
  repHigh: number
  /** Working weight in the user's unit, or null to let history seed it. */
  weight: number | null
  note: string
  /** Set an auto-progression rule on this exercise when saved (§7 Phase 4). */
  autoProgress?: boolean
}

/** One session — becomes one template. */
export interface PlanSession {
  name: string
  exercises: PlanExercise[]
}

// A multi-week program carries week-to-week load via progression rules, not one
// template per day; a single-week plan just has its sessions.
export interface CoachPlan {
  overview: string
  programName: string | null
  durationWeeks: number | null
  sessions: PlanSession[]
}

export interface CoachCritique {
  observations: string[]
  suggestions: string[]
}

// `ask` may itself request a plan, so its response can come back as a plan or prose.
export type CoachRequest =
  | { kind: 'critique' }
  | { kind: 'plan'; goal: string }
  | { kind: 'ask'; question: string }
  /** A warm 1–2 sentence progress note for the Home greeting. Returns `answer`. */
  | { kind: 'encouragement' }

export type CoachResponse =
  | { kind: 'critique'; critique: CoachCritique }
  | { kind: 'plan'; plan: CoachPlan }
  | { kind: 'answer'; text: string }

export interface CoachProvider {
  readonly name: string
  /** The summary is the only data that leaves the device (§2) — never hand a provider more. */
  respond(summary: CoachSummary, request: CoachRequest): Promise<CoachResponse>
  isAvailable(): Promise<boolean>
}
