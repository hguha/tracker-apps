// Live coach via the `coach` Edge Function, which holds the Gemini key server-side.
// The multi-turn chat loop is the generic transport from @tracker-engine/ai-coach,
// wired here with Ledger's finance tools.

import { getSupabase } from '@/backend/supabaseClient'
import { runToolLoop } from '@tracker-engine/ai-coach'
import type {
  CoachAction,
  CoachChatHooks,
  CoachChatResult,
  CoachContext,
  CoachProvider,
  GeminiContent,
} from './types'
import {
  executeRetrievalTool,
  isActionTool,
  TOOL_DECLARATIONS,
  toolLabel,
  toolToAction,
} from './tools'

const MAX_TOOL_ROUNDS = 4

export const geminiCoachProvider: CoachProvider = {
  name: 'COINcidence Coach (Gemini)',

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
      onToolStart: (name) => hooks?.onTool?.(toolLabel(name)),
      fallbackText:
        "I looked through your spending but couldn't pull that together — try asking a bit more specifically.",
    })
  },

  async isAvailable(): Promise<boolean> {
    const supabase = getSupabase()
    if (!supabase) return false
    const { data } = await supabase.auth.getSession()
    return Boolean(data.session)
  },
}
