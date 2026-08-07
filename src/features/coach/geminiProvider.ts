/**
 * The live coach provider — calls the `coach` Edge Function, which holds the
 * Gemini key server-side (§13, §2). The client never sees the key; it sends the
 * de-identified summary and gets back the same typed CoachResponse the mock
 * produces, so nothing downstream changes.
 *
 * If the backend isn't configured, the function errors, or the network is down,
 * `respond` throws and the caller falls back to the offline mock — the coach is
 * always usable, just less clever.
 */

import { getSupabase } from '@/sync/supabaseClient'
import type { CoachSummary } from './summary'
import type { CoachProvider, CoachRequest, CoachResponse } from './types'

export const geminiCoachProvider: CoachProvider = {
  name: 'FitNote Coach (Gemini)',

  async respond(summary: CoachSummary, request: CoachRequest): Promise<CoachResponse> {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Backend not configured')

    // invoke() attaches the signed-in user's JWT, which the function verifies.
    const { data, error } = await supabase.functions.invoke('coach', {
      body: { summary, request },
    })
    if (error) throw error

    // Trust but verify the shape — a malformed response falls back to the mock.
    if (
      data &&
      (data.kind === 'critique' || data.kind === 'plan' || data.kind === 'answer')
    ) {
      return data as CoachResponse
    }
    throw new Error('Malformed coach response')
  },

  async isAvailable(): Promise<boolean> {
    const supabase = getSupabase()
    if (!supabase) return false
    // Available when a user is signed in — the function requires a JWT.
    const { data } = await supabase.auth.getSession()
    return Boolean(data.session)
  },
}
