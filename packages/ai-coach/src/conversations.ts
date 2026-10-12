import type { CoachMessage, ConversationStore, StoredConversation } from './chat'
import type { GeminiContent } from './types'

export interface ConversationRow {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  contents: unknown[]
  items: unknown[]
}

export interface ConversationTable {
  get(id: string): PromiseLike<ConversationRow | undefined>
  put(row: ConversationRow): PromiseLike<unknown>
  delete(id: string): PromiseLike<void>
  orderBy(index: 'updatedAt'): {
    reverse(): {
      toArray(): PromiseLike<ConversationRow[]>
      first(): PromiseLike<ConversationRow | undefined>
    }
  }
}

export interface ConversationMeta {
  id: string
  title: string
  updatedAt: number
}

export interface ConversationHistory<TAction> extends ConversationStore<TAction> {
  list: () => Promise<ConversationMeta[]>
  load: (id: string) => Promise<StoredConversation<TAction> | null>
  remove: (id: string) => Promise<void>
}

export function createConversationHistory<TAction>(
  table: ConversationTable,
): ConversationHistory<TAction> {
  const fromRow = (row: ConversationRow): StoredConversation<TAction> => ({
    id: row.id,
    title: row.title,
    contents: row.contents as GeminiContent[],
    items: row.items as CoachMessage<TAction>[],
  })

  return {
    async list() {
      const rows = await table.orderBy('updatedAt').reverse().toArray()
      return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt }))
    },
    async load(id) {
      const row = await table.get(id)
      return row ? fromRow(row) : null
    },
    async mostRecent() {
      const row = await table.orderBy('updatedAt').reverse().first()
      return row ? fromRow(row) : null
    },
    async save(conversation) {
      const existing = await table.get(conversation.id)
      const now = Date.now()
      await table.put({
        ...conversation,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    },
    async remove(id) {
      await table.delete(id)
    },
  }
}
