import { useEffect, useRef, useState } from 'react'
import { Timer } from 'lucide-react'
import { formatClock } from '@/lib/units'
import { parseDuration } from '@/features/workout/SetRow'
import { remainingSeconds, useRestTimer } from './restTimerStore'
import {
  cancelScheduledRest,
  playCue,
  scheduleRestComplete,
  signalRestComplete,
} from './sounds'

// Seconds remaining when the heads-up tick fires (§6.8).
const WARNING_AT = 10
const EXPIRED_LINGER_MS = 8000
// The one-tap presets (§12.1).
const REST_PRESETS = [60, 180, 300] as const

export function RestTimerBar({
  defaultSeconds,
  onExpire,
}: {
  defaultSeconds: number
  onExpire?: () => void
}) {
  const targetAt = useRestTimer((s) => s.targetAt)
  const plannedSeconds = useRestTimer((s) => s.plannedSeconds)
  const start = useRestTimer((s) => s.start)
  const extend = useRestTimer((s) => s.extend)
  const cancel = useRestTimer((s) => s.cancel)

  const [remaining, setRemaining] = useState(() => remainingSeconds(targetAt))
  const [hasExpired, setHasExpired] = useState(false)
  const hasFired = useRef(false)
  const hasWarned = useRef(false)
  const lingerTimeout = useRef<number | null>(null)

  useEffect(() => {
    if (targetAt === null) {
      cancelScheduledRest()
      return
    }
    hasFired.current = false
    hasWarned.current = false
    setHasExpired(false)
    setRemaining(remainingSeconds(targetAt))

    // Queue the chime on the audio clock as well as the interval below: JS timers
    // are frozen while the app is backgrounded, which is when rest usually ends.
    scheduleRestComplete((targetAt - Date.now()) / 1000)

    const id = window.setInterval(() => setRemaining(remainingSeconds(targetAt)), 250)
    return () => clearInterval(id)
  }, [targetAt])

  useEffect(() => {
    if (targetAt === null) return

    // A heads-up tick, so the expiry chime isn't the first warning.
    if (!hasWarned.current && remaining > 0 && remaining <= WARNING_AT) {
      hasWarned.current = true
      playCue('rest-warning')
      // Reaching this proves timers are live, so the foreground chime below will
      // fire. Drop the queued backup now rather than racing it at expiry.
      cancelScheduledRest()
    }

    // Recompute from the target, not `remaining`, which can still be a stale 0 in the same commit a fresh timer starts.
    if (!hasFired.current && remainingSeconds(targetAt) === 0) {
      hasFired.current = true
      setHasExpired(true)
      // Noticeably late means timers were frozen and the queued chime already
      // played while the app was in the background — don't sound it twice.
      const isLate = Date.now() - targetAt > 3000
      cancelScheduledRest()
      if (!isLate) signalRestComplete()
      onExpire?.()
      // Hold the "rest over" message briefly; tracked so cleanup can cancel it if the bar unmounts first.
      lingerTimeout.current = window.setTimeout(() => {
        setHasExpired(false)
        cancel()
      }, EXPIRED_LINGER_MS)
    }
  }, [remaining, targetAt, onExpire, cancel])

  useEffect(() => {
    return () => {
      if (lingerTimeout.current !== null) clearTimeout(lingerTimeout.current)
    }
  }, [])

  const isRunning = targetAt !== null && remaining > 0
  const isEndingSoon = isRunning && remaining <= WARNING_AT

  if (!isRunning && !hasExpired) {
    return (
      <RestStartBar
        defaultSeconds={defaultSeconds}
        onStart={(seconds) => start(seconds, { setId: null, exerciseId: null })}
      />
    )
  }

  if (hasExpired) {
    return (
      <div className="border-t border-line bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span
            className="flex items-center gap-2 text-[15px] font-bold"
            style={{ color: 'var(--status-good)' }}
          >
            <Timer size={17} />
            Rest over
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => start(defaultSeconds, { setId: null, exerciseId: null })}
              className="h-9 rounded-lg bg-sunken px-3 text-[13px] font-semibold active:bg-accent-wash"
            >
              Again
            </button>
            <button
              onClick={() => {
                setHasExpired(false)
                cancel()
              }}
              className="h-9 px-2 text-[13px] font-semibold text-ink-secondary active:opacity-60"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    )
  }

  const elapsed = plannedSeconds - remaining
  const progress = plannedSeconds > 0 ? Math.min(1, elapsed / plannedSeconds) : 1

  return (
    <div className="border-t border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Rest
        </span>
        <span
          className="tabular w-14 text-[19px] font-bold"
          style={{ color: isEndingSoon ? 'var(--status-warning)' : undefined }}
        >
          {formatClock(remaining)}
        </span>

        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-linear"
            style={{ width: `${progress * 100}%`, background: 'var(--accent)' }}
          />
        </div>

        <button
          onClick={() => extend(30)}
          className="h-9 shrink-0 rounded-lg bg-sunken px-2.5 text-[13px] font-semibold active:bg-accent-wash"
        >
          +30s
        </button>
        <button
          onClick={cancel}
          className="h-9 shrink-0 px-1 text-[13px] font-semibold text-ink-secondary active:opacity-60"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

function RestStartBar({
  defaultSeconds,
  onStart,
}: {
  defaultSeconds: number
  onStart: (seconds: number) => void
}) {
  const [isCustom, setIsCustom] = useState(false)
  const [draft, setDraft] = useState('')

  function commitCustom() {
    const seconds = parseDuration(draft)
    setIsCustom(false)
    setDraft('')
    if (seconds !== null && seconds > 0) onStart(seconds)
  }

  if (isCustom) {
    return (
      <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Rest
        </span>
        <input
          autoFocus
          value={draft}
          inputMode="numeric"
          placeholder="m:ss"
          aria-label="custom rest duration"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitCustom()
          }}
          className="tabular h-11 min-w-0 flex-1 rounded-xl border border-line bg-sunken text-center text-[16px] font-semibold focus:border-accent focus:outline-none"
        />
        <button
          onClick={commitCustom}
          className="h-11 shrink-0 rounded-xl bg-accent px-4 text-[14px] font-semibold text-accent-contrast active:opacity-80"
        >
          Start
        </button>
        <button
          onClick={() => {
            setIsCustom(false)
            setDraft('')
          }}
          className="h-11 shrink-0 px-1 text-[13px] font-semibold text-ink-secondary active:opacity-60"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 border-t border-line bg-surface px-3 py-2">
      <span className="mr-0.5 flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        <Timer size={14} />
        Rest
      </span>
      {REST_PRESETS.map((seconds) => (
        <button
          key={seconds}
          onClick={() => onStart(seconds)}
          className={
            'h-11 flex-1 rounded-xl text-[14.5px] font-semibold active:bg-accent-wash ' +
            (seconds === defaultSeconds
              ? 'bg-accent-wash text-accent ring-1 ring-inset ring-accent'
              : 'bg-sunken text-ink-secondary')
          }
        >
          {formatClock(seconds)}
        </button>
      ))}
      <button
        onClick={() => setIsCustom(true)}
        className="h-11 shrink-0 rounded-xl bg-sunken px-3.5 text-[13px] font-semibold text-ink-secondary active:bg-accent-wash"
      >
        Custom
      </button>
    </div>
  )
}
