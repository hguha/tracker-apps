import { describe, expect, it, vi } from 'vitest'
import type { GeminiContent } from '@/features/coach/types'

const invoke = vi.fn()
vi.mock('@/backend/supabaseClient', () => ({
  getSupabase: () => ({ functions: { invoke } }),
}))

const { buildCoachContext, geminiCoachProvider } = await import('@/features/coach/geminiProvider')
const { mockCoachProvider } = await import('@/features/coach/mockProvider')

const question: GeminiContent[] = [{ role: 'user', parts: [{ text: 'How is my trend?' }] }]

describe('coach history', () => {
  it('keeps the tool calls and their results for the next turn', async () => {
    invoke
      .mockResolvedValueOnce({
        data: {
          kind: 'toolCalls',
          text: '',
          calls: [{ name: 'getWeightTrend', args: {} }],
          modelParts: [{ functionCall: { name: 'getWeightTrend', args: {} } }],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { kind: 'message', text: 'Steady.' }, error: null })

    const result = await geminiCoachProvider.chat(question, await buildCoachContext())

    expect(result.contents.map((turn) => turn.role)).toEqual(['user', 'model', 'user', 'model'])
    expect(result.contents[2]?.parts[0]?.functionResponse?.name).toBe('getWeightTrend')
  })

  it('ends an action turn on the reply text, not an unanswered call', async () => {
    invoke.mockResolvedValueOnce({
      data: {
        kind: 'toolCalls',
        text: 'Here is a dinner.',
        calls: [{ name: 'suggestMeal', args: { title: 'Dinner', items: [], note: '' } }],
        modelParts: [{ functionCall: { name: 'suggestMeal', args: {} } }],
      },
      error: null,
    })

    const result = await geminiCoachProvider.chat(question, await buildCoachContext())

    expect(result.contents).toEqual([
      ...question,
      { role: 'model', parts: [{ text: 'Here is a dinner.' }] },
    ])
  })

  it('records the offline answer as the model turn', async () => {
    const result = await mockCoachProvider.chat(question, await buildCoachContext())
    expect(result.contents).toEqual([...question, { role: 'model', parts: [{ text: result.text }] }])
  })
})
