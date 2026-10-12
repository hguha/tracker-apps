import type { GeminiContent } from './types'

export type CoachMessage<TAction> =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'assistant'; action: TAction }

export interface CoachReply<TAction> {
  contents: GeminiContent[]
  text: string
  action?: TAction | null
}

export interface CoachBackends<TAction> {
  isLiveAvailable: () => Promise<boolean>
  live: (
    contents: GeminiContent[],
    onTool: (label: string) => void,
  ) => Promise<CoachReply<TAction>>
  offline: (contents: GeminiContent[]) => Promise<CoachReply<TAction>>
  onLiveError: (message: string) => void
}

export interface CoachTurn<TAction> {
  contents: GeminiContent[]
  messages: CoachMessage<TAction>[]
  isOffline: boolean
}

export interface StoredConversation<TAction> {
  id: string
  title: string
  contents: GeminiContent[]
  items: CoachMessage<TAction>[]
}

export interface ConversationStore<TAction> {
  mostRecent: () => Promise<StoredConversation<TAction> | null>
  save: (conversation: StoredConversation<TAction>) => Promise<void>
}

export const UNCLEAR_REPLY = "I'm not sure how to help with that — try rephrasing?"
export const NO_REPLY = 'The coach could not respond — try again.'

const MAX_TITLE = 60

export function conversationTitleFrom(firstUserText: string): string {
  const text = firstUserText.trim().replace(/\s+/g, ' ')
  return (text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text) || 'New chat'
}

export async function coachTurn<TAction>(
  backends: CoachBackends<TAction>,
  contents: GeminiContent[],
  onTool: (label: string) => void,
): Promise<CoachTurn<TAction>> {
  let isLive = false
  try {
    isLive = await backends.isLiveAvailable()
  } catch (error) {
    console.warn('[coach] could not check the live coach', error)
  }

  if (isLive) {
    try {
      return turnFrom(await backends.live(contents, onTool), false)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('[coach] live chat failed:', detail)
      backends.onLiveError(detail)
    }
  }

  try {
    return turnFrom(await backends.offline(contents), true)
  } catch (error) {
    console.error('[coach] offline coach failed', error)
    return { contents, messages: [{ role: 'assistant', text: NO_REPLY }], isOffline: true }
  }
}

function turnFrom<TAction>(reply: CoachReply<TAction>, isOffline: boolean): CoachTurn<TAction> {
  const messages: CoachMessage<TAction>[] = []
  if (reply.text) messages.push({ role: 'assistant', text: reply.text })
  if (reply.action) messages.push({ role: 'assistant', action: reply.action })
  if (messages.length === 0) messages.push({ role: 'assistant', text: UNCLEAR_REPLY })
  return { contents: reply.contents, messages, isOffline }
}
