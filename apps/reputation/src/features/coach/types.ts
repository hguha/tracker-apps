// The AI coach interface and its structured output (§13): mock and live provider
// share this contract, and a plan deserializes straight into templates, not prose.

import type { Equipment } from '@/domain/types'
import type { CoachSummary } from '@/data/coachSummary'
import type {
  EdgeTurn,
  GeminiContent,
  GeminiFunctionCall,
  GeminiPart,
  GeminiRole,
  ToolDeclaration,
} from '@tracker-engine/ai-coach'
// Type-only (erased under verbatimModuleSyntax), so no runtime import cycle with
// context.ts → repository → templates → this file.
import type { CoachContext } from './context'

export interface PlanExercise {
  /** Matched to a library id when materialized. */
  name: string
  sets: number
  repLow: number
  repHigh: number
  /** Working weight in the user's unit, or null to let history seed it. */
  weight: number | null
  /**
   * How it's loaded. Names are equipment-free movements, so without this a cable
   * movement gets resolved from its name or the user's own history instead.
   */
  equipment?: Equipment | null
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

// ───────────────────────── Conversational chat (multi-turn) ─────────────────────
// The chat coach is a tool-using agent: the model calls typed tools that execute on
// the client against IndexedDB (tools.ts), so the loop bounces client→edge→Gemini.
// The Gemini wire types + the tool-calling loop live in @tracker-engine/ai-coach; the
// workout tools/prompts/actions below are this app's. Re-exported so existing
// '@/features/coach/types' importers are unchanged. (CoachTurn = the package's EdgeTurn.)
export type {
  GeminiContent,
  GeminiFunctionCall,
  GeminiPart,
  GeminiRole,
  ToolDeclaration,
}
export type { EdgeTurn as CoachTurn }

// A terminal action the model surfaced for the UI to render as an interactive card.
export type CoachAction =
  | { kind: 'plan'; plan: CoachPlan }
  | {
      kind: 'templateUpdate'
      templateId: string
      templateName: string
      session: PlanSession
      note: string
    }
  | { kind: 'accessories'; exercises: PlanExercise[]; note: string }

export interface CoachChatResult {
  // The full conversation including this round, for the next turn.
  contents: GeminiContent[]
  // The assistant's visible reply (may be empty when only an action card is shown).
  text: string
  // A card the UI should render, if the model invoked an action tool.
  action?: CoachAction
}

export interface CoachChatHooks {
  // Fired when a retrieval tool starts, so the UI can show a status chip.
  onTool?: (label: string) => void
}

export interface CoachProvider {
  readonly name: string
  /** The one-shot path (critique/plan/ask/encouragement) — see summary.ts. */
  respond(summary: CoachSummary, request: CoachRequest): Promise<CoachResponse>
  /**
   * One user-message→assistant-reply cycle of the multi-turn chat, driving any
   * client-side tool rounds internally. `contents` already includes the new user
   * turn. Optional so the offline mock can degrade without full tool-calling.
   */
  chat?(
    contents: GeminiContent[],
    context: CoachContext,
    hooks?: CoachChatHooks,
  ): Promise<CoachChatResult>
  isAvailable(): Promise<boolean>
}
