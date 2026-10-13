import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoachBackends, ConversationStore, StoredConversation } from '../src/chat'
import { useCoachChat } from '../src/react/useCoachChat'
import type { GeminiContent } from '../src/types'

afterEach(cleanup)

const reply = (contents: GeminiContent[], text: string) => ({
  contents: [...contents, { role: 'model' as const, parts: [{ text }] }],
  text,
})

function backends(overrides: Partial<CoachBackends<never>> = {}): CoachBackends<never> {
  return {
    isLiveAvailable: async () => true,
    live: async (contents) => reply(contents, 'live answer'),
    offline: async (contents) => reply(contents, 'offline answer'),
    onLiveError: () => {},
    ...overrides,
  }
}

const stored: StoredConversation<never> = {
  id: 'old',
  title: 'Old chat',
  contents: [{ role: 'user', parts: [{ text: 'earlier' }] }],
  items: [
    { role: 'user', text: 'earlier' },
    { role: 'assistant', text: 'earlier answer' },
  ],
}

const texts = (items: { role: string; text?: string }[]) => items.map((item) => item.text)

describe('useCoachChat', () => {
  it('falls back to the offline coach and says why when the live one fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onLiveError = vi.fn()
    const live = vi.fn(async () => {
      throw new Error('rate limited')
    })
    const { result } = renderHook(() =>
      useCoachChat({ backends: backends({ live, onLiveError }) }),
    )

    await act(() => result.current.send('How am I doing?'))

    expect(onLiveError).toHaveBeenCalledWith('rate limited')
    expect(result.current.isOffline).toBe(true)
    expect(texts(result.current.items)).toEqual(['How am I doing?', 'offline answer'])
  })

  it('reopens the most recent conversation when nothing has been said yet', async () => {
    const store: ConversationStore<never> = {
      mostRecent: async () => stored,
      save: async () => {},
    }
    const chat = backends()
    const { result } = renderHook(() => useCoachChat({ backends: chat, store }))
    await waitFor(() => expect(result.current.conversationId).toBe('old'))
    expect(texts(result.current.items)).toEqual(['earlier', 'earlier answer'])
  })

  it('never replaces a chat already started with the restored one', async () => {
    let restore!: (value: StoredConversation<never>) => void
    const store: ConversationStore<never> = {
      mostRecent: () => new Promise((resolve) => (restore = resolve)),
      save: async () => {},
    }
    const chat = backends()
    const { result } = renderHook(() => useCoachChat({ backends: chat, store }))

    await act(() => result.current.send('New question'))
    await act(async () => restore(stored))

    expect(texts(result.current.items)).toEqual(['New question', 'live answer'])
    expect(result.current.conversationId).not.toBe('old')
  })

  it('saves the conversation, titled from its first message', async () => {
    const save = vi.fn(async () => {})
    const store: ConversationStore<never> = { mostRecent: async () => null, save }
    const chat = backends()
    const { result } = renderHook(() => useCoachChat({ backends: chat, store }))

    await act(() => result.current.send('Plan my week'))

    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: 'Plan my week',
          items: [
            { role: 'user', text: 'Plan my week' },
            { role: 'assistant', text: 'live answer' },
          ],
        }),
      ),
    )
  })
})
