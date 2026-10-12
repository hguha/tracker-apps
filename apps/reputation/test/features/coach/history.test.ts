import { beforeEach, describe, expect, it } from 'vitest'
import { conversationTitleFrom } from '@tracker-engine/ai-coach'
import { db } from '@/db/database'
import { LOCAL_USER_ID, seedIfNeeded, setActiveUserId } from '@/db/seed'
import { conversations } from '@/features/coach/history'
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
    await conversations.save({
      id: 'c1',
      title: 'Bench talk',
      contents,
      items: [{ role: 'user', text: 'hi' }],
    })
    const loaded = await conversations.load('c1')
    expect(loaded?.title).toBe('Bench talk')
    expect(loaded?.contents).toEqual(contents)
    expect(loaded?.items).toEqual([{ role: 'user', text: 'hi' }])

    const list = await conversations.list()
    expect(list.map((c) => c.id)).toEqual(['c1'])
  })

  it('orders by most-recently updated and reports the latest', async () => {
    // Space the writes so updatedAt (Date.now()) is strictly monotonic — three
    // saves in the same millisecond would tie and defeat the ordering.
    const tick = () => new Promise((r) => setTimeout(r, 3))
    await conversations.save({ id: 'a', title: 'A', contents, items: [{ role: 'user', text: 'a' }] })
    await tick()
    await conversations.save({ id: 'b', title: 'B', contents, items: [{ role: 'user', text: 'b' }] })
    await tick()
    // Re-saving 'a' bumps its updatedAt above 'b'.
    await conversations.save({ id: 'a', title: 'A2', contents, items: [{ role: 'user', text: 'a2' }] })

    const list = await conversations.list()
    expect(list[0]!.id).toBe('a')
    expect((await conversations.mostRecent())?.id).toBe('a')
    expect((await conversations.mostRecent())?.title).toBe('A2')
  })

  it('keeps when a conversation was started across saves', async () => {
    await conversations.save({ id: 'c1', title: 'x', contents, items: [{ role: 'user', text: 'hi' }] })
    const first = await db.coachConversations.get('c1')
    await new Promise((r) => setTimeout(r, 3))
    await conversations.save({ id: 'c1', title: 'x', contents, items: [{ role: 'user', text: 'hi' }] })
    const second = await db.coachConversations.get('c1')
    expect(second?.createdAt).toBe(first?.createdAt)
    expect(second!.updatedAt).toBeGreaterThan(first!.updatedAt)
  })

  it('deletes a conversation', async () => {
    await conversations.save({ id: 'c1', title: 'x', contents, items: [{ role: 'user', text: 'hi' }] })
    await conversations.remove('c1')
    expect(await conversations.load('c1')).toBeNull()
    expect(await conversations.mostRecent()).toBeNull()
  })
})
