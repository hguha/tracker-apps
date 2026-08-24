// Live coach via the `coach` Edge Function, which holds the Gemini key server-side
// (§13, §2); throws on any failure so the caller can fall back to the offline mock.
// The multi-turn chat loop is the generic transport from @tracker-engine/ai-coach,
// wired here with REPutation's workout tools.

import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import { runToolLoop } from '@tracker-engine/ai-coach'
import type { CoachSummary } from '@/data/coachSummary'
import type { CoachContext } from './context'
import type {
  CoachAction,
  CoachChatHooks,
  CoachChatResult,
  CoachProvider,
  CoachRequest,
  CoachResponse,
  GeminiContent,
} from './types'
import {
  executeRetrievalTool,
  isActionTool,
  TOOL_DECLARATIONS,
  toolLabel,
  toolToAction,
} from './tools'

// Cap tool rounds per message so one turn can't exhaust the shared free-tier quota.
const MAX_TOOL_ROUNDS = 4

export const geminiCoachProvider: CoachProvider = {
  name: 'REPutation Coach (Gemini)',

  async respond(summary: CoachSummary, request: CoachRequest): Promise<CoachResponse> {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Backend not configured')

    // Send the exercise-name allowlist so plans use saveable lifts; names aren't identifying.
    const library = (await repo.listExercises()).map((e) => e.name)

    // invoke() attaches the signed-in user's JWT, which the function verifies.
    const { data, error } = await supabase.functions.invoke('coach', {
      body: { summary, request, library },
    })
    if (error) throw error

    if (
      data &&
      (data.kind === 'critique' || data.kind === 'plan' || data.kind === 'answer')
    ) {
      return data as CoachResponse
    }
    throw new Error('Malformed coach response')
  },

  // One user-message→reply cycle. Retrieval tool calls loop (run locally, feed the
  // result back); an action tool is terminal — surfaces a card and ends the turn.
  chat(
    contents: GeminiContent[],
    context: CoachContext,
    hooks?: CoachChatHooks,
  ): Promise<CoachChatResult> {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Backend not configured')

    return runToolLoop<CoachAction>(supabase, contents, {
      functionName: 'coach',
      body: (working) => ({ mode: 'chat', contents: working, context, tools: TOOL_DECLARATIONS }),
      maxRounds: MAX_TOOL_ROUNDS,
      isTerminal: isActionTool,
      toAction: toolToAction,
      executeTool: executeRetrievalTool,
      onToolStart: (name, args) => hooks?.onTool?.(toolLabel(name, args)),
      fallbackText:
        "I looked through your training but couldn't pull that together — try asking a bit more specifically.",
    })
  },

  async isAvailable(): Promise<boolean> {
    const supabase = getSupabase()
    if (!supabase) return false
    // Available when a user is signed in — the function requires a JWT.
    const { data } = await supabase.auth.getSession()
    return Boolean(data.session)
  },
}
