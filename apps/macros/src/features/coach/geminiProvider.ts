import { runToolLoop } from '@tracker-engine/ai-coach'
import { dayKey } from '@tracker-engine/core'
import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'
import { dayTotals, mgToGrams } from '@/lib/nutrition'
import {
  executeRetrievalTool,
  isActionTool,
  TOOL_DECLARATIONS,
  toolLabel,
  toolToAction,
} from './tools'
import type {
  CoachAction,
  CoachChatHooks,
  CoachChatResult,
  CoachContext,
  CoachProvider,
  GeminiContent,
} from './types'

// Cap tool rounds per message so one turn can't exhaust the shared free-tier quota.
const MAX_TOOL_ROUNDS = 5

/**
 * The live coach, via the `coach` Edge Function which holds the Gemini key server-side.
 * Throws on any failure so the caller falls back to the offline provider rather than showing
 * an error — a rate-limited free tier is an expected state, not a fault.
 */
export const geminiCoachProvider: CoachProvider = {
  name: 'MACROcosm coach',

  async isAvailable() {
    const client = getSupabase()
    if (!client) return false
    // The function verifies a JWT, so it needs a real session — device-only can't use it.
    const { data } = await client.auth.getSession()
    return Boolean(data.session)
  },

  async chat(
    contents: GeminiContent[],
    context: CoachContext,
    hooks?: CoachChatHooks,
  ): Promise<CoachChatResult> {
    const client = getSupabase()
    if (!client) throw new Error('Backend not configured')

    const result = await runToolLoop<CoachAction>(client, contents, {
      functionName: 'coach',
      body: (working) => ({ contents: working, context, tools: TOOL_DECLARATIONS }),
      maxRounds: MAX_TOOL_ROUNDS,
      isTerminal: isActionTool,
      toAction: toolToAction,
      executeTool: executeRetrievalTool,
      onToolStart: (name, args) => hooks?.onTool?.(toolLabel(name, args)),
      fallbackText:
        "I looked at your numbers but couldn't pull that together — try asking a bit more specifically.",
    })
    return { text: result.text, action: result.action ?? null }
  },
}

/** Built once per turn, so the opening context isn't recomputed on every tool round. */
export async function buildCoachContext(): Promise<CoachContext> {
  const totals = dayTotals(await repo.entriesForDay(dayKey(Date.now())))
  const targets = await repo.currentTargets()
  const program = await repo.activeProgram()
  const profile = await repo.getProfile()
  return {
    today: { kcal: totals.kcal, proteinG: Math.round(mgToGrams(totals.proteinMg)) },
    targetKcal: targets?.kcal ?? null,
    goal: program?.goal ?? null,
    units: profile.units,
    dietNotes: profile.dietNotes,
  }
}
