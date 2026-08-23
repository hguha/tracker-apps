// Live coach via the `coach` Edge Function, which holds the Gemini key server-side
// (§13, §2); throws on any failure so the caller can fall back to the offline mock.

import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import type { CoachSummary } from '@/data/coachSummary'
import type { CoachContext } from './context'
import type {
  CoachChatHooks,
  CoachChatResult,
  CoachProvider,
  CoachRequest,
  CoachResponse,
  CoachTurn,
  GeminiContent,
  GeminiPart,
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

// supabase-js hides the server's error body in a FunctionsHttpError; pull out its
// `error` string so the real cause (e.g. a Gemini schema rejection) surfaces.
async function describeInvokeError(error: unknown): Promise<Error> {
  const context = (error as { context?: Response }).context
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json()
      if (body?.error) return new Error(String(body.error))
    } catch {
      // fall through to the generic message
    }
  }
  return error instanceof Error ? error : new Error('Coach request failed')
}

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

  // One user-message→reply cycle: retrieval tool calls loop (run locally, feed the
  // result back); an action tool is terminal — surfaces a card and ends the turn.
  async chat(
    contents: GeminiContent[],
    context: CoachContext,
    hooks?: CoachChatHooks,
  ): Promise<CoachChatResult> {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Backend not configured')

    const working = [...contents]

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const { data, error } = await supabase.functions.invoke('coach', {
        body: { mode: 'chat', contents: working, context, tools: TOOL_DECLARATIONS },
      })
      if (error) throw await describeInvokeError(error)
      const turn = data as CoachTurn
      if (!turn?.kind) throw new Error('Malformed coach response')

      if (turn.kind === 'message') {
        working.push({ role: 'model', parts: [{ text: turn.text }] })
        return { contents: working, text: turn.text }
      }

      // Append the model's turn EXACTLY as Gemini returned it — the functionCall
      // parts carry a thoughtSignature that must be sent back verbatim next round.
      working.push({ role: 'model', parts: turn.modelParts })

      // An action tool ends the turn with a card for the user to act on.
      const action = turn.calls.find((c) => isActionTool(c.name))
      if (action) {
        return {
          contents: working,
          text: turn.text,
          action: (await toolToAction(action.name, action.args)) ?? undefined,
        }
      }

      // Retrieval tools: run each locally, feed the results back, and loop.
      const responseParts: GeminiPart[] = []
      for (const call of turn.calls) {
        hooks?.onTool?.(toolLabel(call.name, call.args))
        const response = await executeRetrievalTool(call.name, call.args)
        responseParts.push({ functionResponse: { name: call.name, response } })
      }
      working.push({ role: 'user', parts: responseParts })
    }

    // Hit the tool-round cap without a final answer — return gracefully.
    return {
      contents: working,
      text: "I looked through your training but couldn't pull that together — try asking a bit more specifically.",
    }
  },

  async isAvailable(): Promise<boolean> {
    const supabase = getSupabase()
    if (!supabase) return false
    // Available when a user is signed in — the function requires a JWT.
    const { data } = await supabase.auth.getSession()
    return Boolean(data.session)
  },
}
