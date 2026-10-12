import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createErrorReporter } from '../src/errorReporter'

function clientWith(userId: string | null) {
  const insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }))
  const client = {
    auth: {
      getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }),
    },
    from: (table: string) => {
      expect(table).toBe('client_errors')
      return { insert }
    },
  } as unknown as SupabaseClient
  return { client, insert }
}

describe('createErrorReporter', () => {
  it('writes a scrubbed row for a signed-in user', async () => {
    const { client, insert } = clientWith('u1')
    const reporter = createErrorReporter({ client: () => client, appVersion: '1.2.3' })

    await reporter.reportError('sync-dead-letter', new Error('boom'))

    expect(insert).toHaveBeenCalledOnce()
    expect(insert.mock.calls[0]![0]).toMatchObject({
      user_id: 'u1',
      app_version: '1.2.3',
      context: 'sync-dead-letter',
      message: 'boom',
    })
  })

  it('sends nothing without a signed-in user', async () => {
    const { client, insert } = clientWith(null)
    await createErrorReporter({ client: () => client, appVersion: '1' }).reportError('x', 'e')
    expect(insert).not.toHaveBeenCalled()
  })

  it('drops the same error repeated within a minute', async () => {
    let time = 0
    const { client, insert } = clientWith('u1')
    const reporter = createErrorReporter({ client: () => client, appVersion: '1', now: () => time })

    await reporter.reportError('x', 'same')
    await reporter.reportError('x', 'same')
    time = 61_000
    await reporter.reportError('x', 'same')

    expect(insert).toHaveBeenCalledTimes(2)
  })
})
