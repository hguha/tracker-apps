// Local persistence for full-screen coach chats (§13): IndexedDB only, never synced
// — a conversation is device UI state, not domain data (hence Dexie here directly,
// like the rest-timer store).

import { createConversationHistory } from '@tracker-engine/ai-coach'
import { db } from '@/db/database'
import type { CoachAction } from './types'

export const conversations = createConversationHistory<CoachAction>(db.coachConversations)
