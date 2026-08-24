// The finance coach contract. The Gemini wire types + the tool-calling loop live in
// @tracker-engine/ai-coach; the finance tools/prompts/actions below are this app's.
// Re-exported so '@/features/coach/*' importers get one place for the types.
// (CoachTurn = the package's EdgeTurn.)

import type {
  EdgeTurn,
  GeminiContent,
  GeminiFunctionCall,
  GeminiPart,
  GeminiRole,
  ToolDeclaration,
} from '@tracker-engine/ai-coach'

export type {
  GeminiContent,
  GeminiFunctionCall,
  GeminiPart,
  GeminiRole,
  ToolDeclaration,
}
export type { EdgeTurn as CoachTurn }

// What the model can see about the current view — never identifying, just scope.
export interface CoachContext {
  month: string | null // YYYY-MM the user is looking at
  currency: string
}

// A terminal action the model surfaced for the UI to render as an interactive card.
export type CoachAction = {
  kind: 'budget'
  categoryId: string
  categoryName: string
  limitMinor: number
  note: string
}

export interface CoachChatResult {
  contents: GeminiContent[]
  text: string
  action?: CoachAction
}

export interface CoachChatHooks {
  onTool?: (label: string) => void
}

export interface CoachProvider {
  readonly name: string
  chat(
    contents: GeminiContent[],
    context: CoachContext,
    hooks?: CoachChatHooks,
  ): Promise<CoachChatResult>
  isAvailable(): Promise<boolean>
}
