// The Gemini chat-with-tools wire types. Domain-agnostic: a coach is a tool-using
// agent whose model calls typed tools that execute on the client, so the loop bounces
// client → edge → Gemini. What the tools *are* is the app's business (see runToolLoop).

export type GeminiRole = 'user' | 'model'

export interface GeminiFunctionCall {
  name: string
  args: Record<string, unknown>
}

// One part of a conversation turn: text, a tool call, or a tool's result.
// `thoughtSignature` is opaque state the thinking models attach to functionCall parts;
// it MUST be echoed back verbatim on the next turn or Gemini 400s, so model turns are
// stored as the raw parts Gemini returned rather than reconstructed.
export interface GeminiPart {
  text?: string
  functionCall?: GeminiFunctionCall
  functionResponse?: { name: string; response: unknown }
  thoughtSignature?: string
}

export interface GeminiContent {
  role: GeminiRole
  parts: GeminiPart[]
}

// A function-calling tool the model may invoke; parameters is a JSON Schema object.
export interface ToolDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// What the edge returns for a single chat round. On tool calls it also returns the
// model's raw parts so the client can append them verbatim (preserving each
// functionCall's thoughtSignature) rather than rebuilding them and losing it.
export type EdgeTurn =
  | { kind: 'message'; text: string }
  | { kind: 'toolCalls'; calls: GeminiFunctionCall[]; modelParts: GeminiPart[]; text: string }
