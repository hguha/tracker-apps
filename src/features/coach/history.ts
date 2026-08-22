// Local persistence for full-screen coach chats (§13). Stored in IndexedDB only —
// never synced — since a conversation is device UI state, not domain data. Kept in
// the coach feature (not the repo/data layer) because it's coach-specific and talks
// to Dexie directly, like the rest-timer store's transient state.

import { db } from '@/db/database'
import type { CoachAction, GeminiContent } from './types'

// The display-side of a message: a bubble or an action card. Mirrors CoachChat's
// item shape without the render-only numeric id.
export type StoredMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'assistant'; action: CoachAction }

export interface ConversationMeta {
  id: string
  title: string
  updatedAt: number
}

export interface LoadedConversation {
  title: string
  contents: GeminiContent[]
  items: StoredMessage[]
}

const MAX_TITLE = 60

export function conversationTitleFrom(firstUserText: string): string {
  const t = firstUserText.trim().replace(/\s+/g, ' ')
  return (t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t) || 'New chat'
}

// Metadata only, newest first — for the history list.
export async function listConversations(): Promise<ConversationMeta[]> {
  const rows = await db.coachConversations.orderBy('updatedAt').reverse().toArray()
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt }))
}

export async function loadConversation(id: string): Promise<LoadedConversation | null> {
  const row = await db.coachConversations.get(id)
  if (!row) return null
  return {
    title: row.title,
    contents: row.contents as GeminiContent[],
    items: row.items as StoredMessage[],
  }
}

export async function saveConversation(input: {
  id: string
  title: string
  contents: GeminiContent[]
  items: StoredMessage[]
}): Promise<void> {
  const existing = await db.coachConversations.get(input.id)
  const now = Date.now()
  await db.coachConversations.put({
    id: input.id,
    title: input.title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    contents: input.contents,
    items: input.items,
  })
}

export async function deleteConversation(id: string): Promise<void> {
  await db.coachConversations.delete(id)
}

export async function mostRecentConversationId(): Promise<string | null> {
  const latest = await db.coachConversations.orderBy('updatedAt').reverse().first()
  return latest?.id ?? null
}
