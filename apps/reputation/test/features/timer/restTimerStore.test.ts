import { afterEach, describe, expect, it } from 'vitest'
import { useRestTimer } from '@/features/timer/restTimerStore'

afterEach(() => useRestTimer.getState().cancel())

describe('dismissExpired', () => {
  it('clears the timer that expired', () => {
    useRestTimer.getState().start(60, { setId: null, exerciseId: null })
    const expired = useRestTimer.getState().targetAt

    useRestTimer.getState().dismissExpired(expired)

    expect(useRestTimer.getState().targetAt).toBeNull()
  })

  it('leaves a timer started after the expiry running', () => {
    useRestTimer.getState().start(60, { setId: null, exerciseId: null })
    const expired = useRestTimer.getState().targetAt
    useRestTimer.getState().start(90, { setId: null, exerciseId: null })
    const restarted = useRestTimer.getState().targetAt

    useRestTimer.getState().dismissExpired(expired)

    expect(useRestTimer.getState().targetAt).toBe(restarted)
  })
})
