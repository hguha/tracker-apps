import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Celebrated } from '@tracker-engine/badges'
import { quietNextCelebrations, useCelebrations, type CelebrationState } from '../src/Celebration'

const badge = (key: string, earned: boolean) => ({
  key,
  label: key,
  caption: '',
  icon: '⭐',
  earned,
})
const state = (earned: string[], level = 1): CelebrationState => ({
  badges: ['a', 'b'].map((key) => badge(key, earned.includes(key))),
  level,
  day: '2026-10-12',
  dayComplete: false,
})

function account(initial: Celebrated | null) {
  const box = { stored: initial }
  return {
    box,
    record: () => ({ stored: box.stored, save: (next: Celebrated) => void (box.stored = next) }),
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('useCelebrations', () => {
  it('queues a badge earned after the first look', () => {
    const { record } = account(null)
    const { result, rerender } = renderHook(({ now }) => useCelebrations(record(), now), {
      initialProps: { now: state([]) },
    })
    expect(result.current.current).toBeNull()

    rerender({ now: state(['a']) })
    expect(result.current.current?.title).toBe('a')
  })

  it('records quietly while quiet, so nothing bursts when it stops', () => {
    const { box, record } = account({ badges: [], level: 1, completedDay: null })
    const { result, rerender } = renderHook(
      ({ now, isQuiet }) => useCelebrations(record(), now, { isQuiet }),
      { initialProps: { now: state(['a', 'b'], 3), isQuiet: true } },
    )
    expect(result.current.current).toBeNull()
    expect(box.stored).toMatchObject({ badges: ['a', 'b'], level: 3 })

    rerender({ now: state(['a', 'b'], 3), isQuiet: false })
    expect(result.current.current).toBeNull()
  })

  it('stays quiet once after quietNextCelebrations, then celebrates again', () => {
    const { record } = account({ badges: [], level: 1, completedDay: null })
    quietNextCelebrations()
    const { result, rerender } = renderHook(({ now }) => useCelebrations(record(), now), {
      initialProps: { now: state(['a']) },
    })
    expect(result.current.current).toBeNull()
    expect(sessionStorage.length).toBe(0)

    rerender({ now: state(['a', 'b']) })
    expect(result.current.current?.title).toBe('b')
  })

  it('gives a celebration pushed twice two different keys', () => {
    const { result } = renderHook(() => useCelebrations(null, null))
    const record = { key: 'pr:set-1', icons: ['🏆'], title: 'PR', subtitle: '' }
    act(() => {
      result.current.push(record)
      result.current.push(record)
    })
    const first = result.current.current!.key
    act(() => result.current.dismiss())
    expect(result.current.current!.key).not.toBe(first)
  })
})
