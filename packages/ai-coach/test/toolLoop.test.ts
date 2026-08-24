import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runToolLoop, type ToolLoopConfig } from '../src/toolLoop'
import type { EdgeTurn } from '../src/types'

// A Supabase client whose functions.invoke returns each scripted turn in order.
function fakeClient(turns: (EdgeTurn | { error: unknown })[]): SupabaseClient {
  let i = 0
  const invoke = vi.fn(async () => {
    const t = turns[i++]
    if (t && 'error' in t) return { data: null, error: t.error }
    return { data: t, error: null }
  })
  return { functions: { invoke } } as unknown as SupabaseClient
}

type Action = { kind: 'plan' }

function config(over: Partial<ToolLoopConfig<Action>> = {}): ToolLoopConfig<Action> {
  return {
    functionName: 'coach',
    body: (contents) => ({ contents }),
    maxRounds: 2,
    isTerminal: (name) => name === 'make_plan',
    toAction: () => ({ kind: 'plan' }),
    executeTool: async () => ({ ok: true }),
    fallbackText: 'gave up',
    ...over,
  }
}

const userTurn = [{ role: 'user' as const, parts: [{ text: 'hi' }] }]

describe('runToolLoop', () => {
  it('returns the model message and appends it to the conversation', async () => {
    const client = fakeClient([{ kind: 'message', text: 'here you go' }])
    const result = await runToolLoop(client, userTurn, config())
    expect(result.text).toBe('here you go')
    expect(result.action).toBeUndefined()
    expect(result.contents.at(-1)).toEqual({ role: 'model', parts: [{ text: 'here you go' }] })
  })

  it('runs a retrieval tool, feeds the result back, then returns the next message', async () => {
    const execute = vi.fn(async () => ({ history: [1, 2] }))
    const client = fakeClient([
      { kind: 'toolCalls', text: '', calls: [{ name: 'get_history', args: { id: 'x' } }], modelParts: [{ functionCall: { name: 'get_history', args: { id: 'x' } } }] },
      { kind: 'message', text: 'analysed' },
    ])
    const result = await runToolLoop(client, userTurn, config({ executeTool: execute }))
    expect(execute).toHaveBeenCalledWith('get_history', { id: 'x' })
    expect(result.text).toBe('analysed')
    // The retrieval result was appended as a functionResponse user turn.
    expect(result.contents.some((c) => c.parts.some((p) => p.functionResponse?.name === 'get_history'))).toBe(true)
  })

  it('ends the turn with an action when a terminal tool is called', async () => {
    const toAction = vi.fn(() => ({ kind: 'plan' as const }))
    const client = fakeClient([
      { kind: 'toolCalls', text: 'made a plan', calls: [{ name: 'make_plan', args: { goal: 'strength' } }], modelParts: [] },
    ])
    const result = await runToolLoop(client, userTurn, config({ toAction }))
    expect(toAction).toHaveBeenCalledWith('make_plan', { goal: 'strength' })
    expect(result.action).toEqual({ kind: 'plan' })
    expect(result.text).toBe('made a plan')
  })

  it('falls back gracefully when the round cap is hit', async () => {
    const retrieval: EdgeTurn = {
      kind: 'toolCalls',
      text: '',
      calls: [{ name: 'get_history', args: {} }],
      modelParts: [],
    }
    const client = fakeClient([retrieval, retrieval, retrieval, retrieval])
    const result = await runToolLoop(client, userTurn, config({ maxRounds: 2 }))
    expect(result.text).toBe('gave up')
  })

  it('surfaces the server error body via describeInvokeError', async () => {
    const error = { context: { json: async () => ({ error: 'Gemini schema rejected' }) } }
    const client = fakeClient([{ error }])
    await expect(runToolLoop(client, userTurn, config())).rejects.toThrow('Gemini schema rejected')
  })
})
