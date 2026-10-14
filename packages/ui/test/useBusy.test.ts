import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useBusy } from '../src/useBusy'

describe('useBusy', () => {
  it('runs the work once when started twice before a re-render', async () => {
    const { result } = renderHook(() => useBusy())
    let runs = 0
    const work = async () => {
      runs += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const [, run] = result.current
    await act(async () => {
      await Promise.all([run(work), run(work)])
    })
    expect(runs).toBe(1)
    expect(result.current[0]).toBe(false)
  })
})
