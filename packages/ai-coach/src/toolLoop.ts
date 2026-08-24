// The client-side tool-calling loop: send the conversation to a Supabase Edge
// Function, and while the model asks for tools, run them and feed results back until
// it answers or surfaces a terminal action. Generic over the app's action type — the
// app supplies the function name, tools, and how to run/classify them.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EdgeTurn, GeminiContent, GeminiPart } from './types'

// supabase-js hides the server's error body in a FunctionsHttpError; pull out its
// `error` string so the real cause (e.g. a Gemini schema rejection) surfaces.
export async function describeInvokeError(error: unknown): Promise<Error> {
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

export interface ToolLoopConfig<TAction> {
  /** Edge Function name to invoke each round. */
  functionName: string
  /** Builds the request body for a round from the current conversation. */
  body: (contents: GeminiContent[]) => Record<string, unknown>
  /** Max tool rounds before giving up, so one turn can't exhaust a shared quota. */
  maxRounds?: number
  /** True if a tool call is terminal — surfaces an action card and ends the turn. */
  isTerminal: (name: string) => boolean
  /** Build the terminal action payload from a terminal tool call. */
  toAction: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<TAction | null> | TAction | null
  /** Run a retrieval tool locally; its result is fed back to the model. */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** Fired when a retrieval tool starts (e.g. to show a status chip). */
  onToolStart?: (name: string, args: Record<string, unknown>) => void
  /** Shown when the round cap is hit without a final answer. */
  fallbackText: string
}

export interface ToolLoopResult<TAction> {
  /** The full conversation including this round, for the next turn. */
  contents: GeminiContent[]
  /** The assistant's visible reply (may be empty when only an action card is shown). */
  text: string
  /** A terminal action the model surfaced, if any. */
  action?: TAction
}

export async function runToolLoop<TAction>(
  client: SupabaseClient,
  contents: GeminiContent[],
  config: ToolLoopConfig<TAction>,
): Promise<ToolLoopResult<TAction>> {
  const maxRounds = config.maxRounds ?? 4
  const working = [...contents]

  for (let round = 0; round <= maxRounds; round += 1) {
    const { data, error } = await client.functions.invoke(config.functionName, {
      body: config.body(working),
    })
    if (error) throw await describeInvokeError(error)
    const turn = data as EdgeTurn
    if (!turn?.kind) throw new Error('Malformed coach response')

    if (turn.kind === 'message') {
      working.push({ role: 'model', parts: [{ text: turn.text }] })
      return { contents: working, text: turn.text }
    }

    // Append the model's turn EXACTLY as returned — functionCall parts carry a
    // thoughtSignature that must be sent back verbatim next round.
    working.push({ role: 'model', parts: turn.modelParts })

    // A terminal tool ends the turn with a card for the user to act on.
    const terminal = turn.calls.find((c) => config.isTerminal(c.name))
    if (terminal) {
      const action = (await config.toAction(terminal.name, terminal.args)) ?? undefined
      return { contents: working, text: turn.text, action }
    }

    // Retrieval tools: run each locally, feed the results back, and loop.
    const responseParts: GeminiPart[] = []
    for (const call of turn.calls) {
      config.onToolStart?.(call.name, call.args)
      const response = await config.executeTool(call.name, call.args)
      responseParts.push({ functionResponse: { name: call.name, response } })
    }
    working.push({ role: 'user', parts: responseParts })
  }

  return { contents: working, text: config.fallbackText }
}
