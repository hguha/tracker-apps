import { createConversationHistory, type ConversationHistory } from '@tracker-engine/ai-coach'
import { db } from '@/db'

export const coachHistory = <TAction>(): ConversationHistory<TAction> =>
  createConversationHistory<TAction>(db.coachConversations)
