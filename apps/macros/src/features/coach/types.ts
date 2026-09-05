import type { GeminiContent } from '@tracker-engine/ai-coach'
import type { MealSlot, Nutrients } from '@/domain/types'

export type { GeminiContent }

/**
 * A terminal tool call: the model proposes something and the turn ends with a card the user
 * confirms. Nothing here is applied automatically — an AI that silently writes to your food
 * log is an AI you stop trusting.
 */
export type CoachAction =
  | {
      kind: 'log-food'
      /** Resolved against the food database, never invented by the model (see lib/nutrition). */
      foodId: string
      description: string
      grams: number
      meal: MealSlot
      nutrients: Nutrients
    }
  | {
      kind: 'suggest-meal'
      title: string
      /** Each item already matched to a food row, so the totals are computed not claimed. */
      items: { foodId: string; description: string; grams: number }[]
      nutrients: Nutrients
      note: string
    }

export interface CoachChatResult {
  text: string
  action: CoachAction | null
}

export interface CoachChatHooks {
  /** Called when a retrieval tool starts, for a status chip. */
  onTool?: (label: string) => void
}

/** The de-identified opening summary. Deliberately small: everything else the model needs it
 *  asks for by tool call, so a conversation never ships the user's history off the device. */
export interface CoachContext {
  today: { kcal: number; proteinG: number }
  targetKcal: number | null
  goal: string | null
  units: string
}

export interface CoachProvider {
  name: string
  isAvailable(): Promise<boolean>
  chat(
    contents: GeminiContent[],
    context: CoachContext,
    hooks?: CoachChatHooks,
  ): Promise<CoachChatResult>
}
