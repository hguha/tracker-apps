import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToday } from '../src/useToday'

afterEach(() => vi.useRealTimers())

describe('useToday', () => {
  it('moves to the next day at local midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 23, 59, 0))
    const { result } = renderHook(() => useToday())
    expect(result.current).toBe('2026-10-12')

    act(() => void vi.advanceTimersByTime(2 * 60_000))
    expect(result.current).toBe('2026-10-13')

    act(() => void vi.advanceTimersByTime(24 * 60 * 60_000))
    expect(result.current).toBe('2026-10-14')
  })

  it('catches up when the app comes back from the background', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 21, 0, 0))
    const { result } = renderHook(() => useToday())
    vi.setSystemTime(new Date(2026, 9, 13, 8, 0, 0))
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(result.current).toBe('2026-10-13')
  })
})
