/**
 * Rest timer state (§12).
 *
 * The authoritative value is a target timestamp, not a decrementing counter.
 * A counter drifts while the tab is backgrounded and shows a stale number on
 * return; a target timestamp is always correct because remaining time is
 * derived from the clock at read time.
 *
 * Tier 1 (in-app countdown + chime) is what this store implements. Tiers 2 and
 * 3 — service worker and server-scheduled push — attach to the same start and
 * cancel calls later without changing callers.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface RestTimerState {
  /** Wall-clock ms when rest is up. null = no timer running. */
  targetAt: number | null
  /** What was requested, so "+30s" can be distinguished from the original. */
  plannedSeconds: number
  /** When the timer started, so measured rest can be recorded (D-36). */
  startedAt: number | null
  /**
   * Which set to attribute the measured rest to. Null when rest was started from
   * the bar rather than by logging a set — the timer still runs, there is just
   * nothing to attribute it to.
   */
  setId: string | null
  exerciseId: string | null

  start: (
    seconds: number,
    ctx: { setId: string | null; exerciseId: string | null },
  ) => void
  extend: (seconds: number) => void
  cancel: () => void
  /** Seconds actually rested, for `sets.rest_taken_seconds`. */
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
        // Extend from now if the timer already expired, so "+30s" always gives
        // a full 30 seconds rather than a stale remainder.
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
      // Survives a reload mid-rest, so reopening the app shows the real time left.
      name: 'rest-timer',
    },
  ),
)

/** Seconds left, floored at zero. Negative values mean it already fired. */
export function remainingSeconds(targetAt: number | null, now = Date.now()): number {
  if (targetAt === null) return 0
  return Math.max(0, Math.ceil((targetAt - now) / 1000))
}
