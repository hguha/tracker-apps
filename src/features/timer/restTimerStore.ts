// Rest timer state (§12). The authoritative value is a target timestamp, not a
// counter, so it stays correct across a backgrounded tab.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface RestTimerState {
  // Wall-clock ms when rest is up. null = no timer running.
  targetAt: number | null
  plannedSeconds: number
  startedAt: number | null
  // Set to attribute measured rest to; null when started from the bar, not a set.
  setId: string | null
  exerciseId: string | null

  start: (
    seconds: number,
    ctx: { setId: string | null; exerciseId: string | null },
  ) => void
  extend: (seconds: number) => void
  cancel: () => void
  elapsedSeconds: () => number | null
}

export const useRestTimer = create<RestTimerState>()(
  persist(
    (set, get) => ({
      targetAt: null,
      plannedSeconds: 0,
      startedAt: null,
      setId: null,
      exerciseId: null,

      start: (seconds, ctx) => {
        const now = Date.now()
        set({
          targetAt: now + seconds * 1000,
          plannedSeconds: seconds,
          startedAt: now,
          setId: ctx.setId,
          exerciseId: ctx.exerciseId,
        })
      },

      extend: (seconds) => {
        const { targetAt } = get()
        if (targetAt === null) return
        // Extend from now if already expired, so "+30s" always gives a full 30s.
        const base = Math.max(targetAt, Date.now())
        set({ targetAt: base + seconds * 1000 })
      },

      cancel: () => {
        set({
          targetAt: null,
          plannedSeconds: 0,
          startedAt: null,
          setId: null,
          exerciseId: null,
        })
      },

      elapsedSeconds: () => {
        const { startedAt } = get()
        if (startedAt === null) return null
        return Math.round((Date.now() - startedAt) / 1000)
      },
    }),
    {
      // Survives a reload mid-rest.
      name: 'rest-timer',
    },
  ),
)

export function remainingSeconds(targetAt: number | null, now = Date.now()): number {
  if (targetAt === null) return 0
  return Math.max(0, Math.ceil((targetAt - now) / 1000))
}
