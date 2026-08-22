import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import {
  conversationTitleFrom,
  deleteConversation,
  listConversations,
  loadConversation,
  mostRecentConversationId,
  saveConversation,
} from '@/features/coach/history'
import type { GeminiContent } from '@/features/coach/types'

beforeEach(async () => {
  setActiveUserId(LOCAL_USER_ID)
  localStorage.clear()
  await db.delete()
  await db.open()
  await seedIfNeeded()
})

const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: 'hi' }] }]

describe('coach conversation history', () => {
  it('derives a trimmed title from the first message', () => {
    expect(conversationTitleFrom('  How is my bench?  ')).toBe('How is my bench?')
    expect(conversationTitleFrom('')).toBe('New chat')
    expect(conversationTitleFrom('x'.repeat(200))).toHaveLength(60)
  })

  it('saves, loads, and lists a conversation', async () => {
    await saveConversation({
      id: 'c1',
      title: 'Bench talk',
      contents,
      items: [{ role: 'user', text: 'hi' }],
    })
    const loaded = await loadConversation('c1')
    expect(loaded?.title).toBe('Bench talk')
    expect(loaded?.contents).toEqual(contents)
    expect(loaded?.items).toEqual([{ role: 'user', text: 'hi' }])

    const list = await listConversations()
    expect(list.map((c) => c.id)).toEqual(['c1'])
  })

  it('orders by most-recently updated and reports the latest', async () => {
    // Space the writes so updatedAt (Date.now()) is strictly monotonic — three
    // saves in the same millisecond would tie and defeat the ordering.
    const tick = () => new Promise((r) => setTimeout(r, 3))
    await saveConversation({ id: 'a', title: 'A', contents, items: [{ role: 'user', text: 'a' }] })
    await tick()
    await saveConversation({ id: 'b', title: 'B', contents, items: [{ role: 'user', text: 'b' }] })
    await tick()
    // Re-saving 'a' bumps its updatedAt above 'b'.
    await saveConversation({ id: 'a', title: 'A2', contents, items: [{ role: 'user', text: 'a2' }] })

    const list = await listConversations()
    expect(list[0]!.id).toBe('a')
    expect(await mostRecentConversationId()).toBe('a')
  })

  it('deletes a conversation', async () => {
    await saveConversation({ id: 'c1', title: 'x', contents, items: [{ role: 'user', text: 'hi' }] })
    await deleteConversation('c1')
    expect(await loadConversation('c1')).toBeNull()
    expect(await mostRecentConversationId()).toBeNull()
  })
})
