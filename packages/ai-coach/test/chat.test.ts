import { describe, expect, it, vi } from 'vitest'
import {
  coachTurn,
  conversationTitleFrom,
  NO_REPLY,
  UNCLEAR_REPLY,
  type CoachBackends,
} from '../src/chat'
import type { GeminiContent } from '../src/types'

const question: GeminiContent[] = [{ role: 'user', parts: [{ text: 'hi' }] }]
const answered = (text: string): GeminiContent[] => [
  ...question,
  { role: 'model', parts: [{ text }] },
]

function backends(over: Partial<CoachBackends<string>> = {}): CoachBackends<string> {
  return {
    isLiveAvailable: async () => true,
    live: async () => ({ contents: answered('live'), text: 'live' }),
    offline: async () => ({ contents: answered('offline'), text: 'offline' }),
    onLiveError: vi.fn(),
    ...over,
  }
}

describe('coachTurn', () => {
  it('answers live when the live coach is available', async () => {
    const turn = await coachTurn(backends(), question, () => {})
    expect(turn).toEqual({
      contents: answered('live'),
      messages: [{ role: 'assistant', text: 'live' }],
      isOffline: false,
    })
  })

  it('answers offline without trying live when live is unavailable', async () => {
    const live = vi.fn()
    const turn = await coachTurn(backends({ isLiveAvailable: async () => false, live }), question, () => {})
    expect(live).not.toHaveBeenCalled()
    expect(turn.isOffline).toBe(true)
    expect(turn.messages).toEqual([{ role: 'assistant', text: 'offline' }])
  })

  it('falls back offline and reports why when live fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onLiveError = vi.fn()
    const turn = await coachTurn(
      backends({
        live: async () => {
          throw new Error('rate limited')
        },
        onLiveError,
      }),
      question,
      () => {},
    )
    expect(onLiveError).toHaveBeenCalledWith('rate limited')
    expect(turn.contents).toEqual(answered('offline'))
    expect(turn.isOffline).toBe(true)
  })

  it('treats a failed availability check as offline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const turn = await coachTurn(
      backends({
        isLiveAvailable: async () => {
          throw new Error('no session')
        },
      }),
      question,
      () => {},
    )
    expect(turn.isOffline).toBe(true)
  })

  it('shows the card after the text, and says so when there is neither', async () => {
    const withCard = await coachTurn(
      backends({ live: async () => ({ contents: question, text: 'here', action: 'card' }) }),
      question,
      () => {},
    )
    expect(withCard.messages).toEqual([
      { role: 'assistant', text: 'here' },
      { role: 'assistant', action: 'card' },
    ])
    const empty = await coachTurn(
      backends({ live: async () => ({ contents: question, text: '' }) }),
      question,
      () => {},
    )
    expect(empty.messages).toEqual([{ role: 'assistant', text: UNCLEAR_REPLY }])
  })

  it('keeps the conversation and apologises when even the offline coach fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const turn = await coachTurn(
      backends({
        isLiveAvailable: async () => false,
        offline: async () => {
          throw new Error('broken')
        },
      }),
      question,
      () => {},
    )
    expect(turn).toEqual({
      contents: question,
      messages: [{ role: 'assistant', text: NO_REPLY }],
      isOffline: true,
    })
  })

  it('passes tool labels through', async () => {
    const onTool = vi.fn()
    await coachTurn(
      backends({
        live: async (contents, tool) => {
          tool('Reading your log')
          return { contents, text: 'ok' }
        },
      }),
      question,
      onTool,
    )
    expect(onTool).toHaveBeenCalledWith('Reading your log')
  })
})

describe('conversationTitleFrom', () => {
  it('collapses whitespace and trims long titles', () => {
    expect(conversationTitleFrom('  how   is  my bench ')).toBe('how is my bench')
    expect(conversationTitleFrom('x'.repeat(80))).toHaveLength(60)
    expect(conversationTitleFrom('   ')).toBe('New chat')
  })
})
