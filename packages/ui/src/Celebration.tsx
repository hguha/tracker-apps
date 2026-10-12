import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@tracker-engine/platform'
import {
  celebrationsSince,
  type CelebratedBadge,
  type Celebrated,
  type Celebration,
} from '@tracker-engine/badges'

const PIECES = 28
const SHOWN_MS = 3_500
const ACCENT_ONLY = ['var(--accent)']

const KEYFRAMES = `
@keyframes te-confetti-fall {
  0% { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate3d(var(--drift, 0), 105vh, 0) rotate(var(--spin, 540deg)); opacity: 0.9; }
}
@keyframes te-celebrate-pop {
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .te-confetti-piece { display: none; }
  .te-celebrate-pop { animation: none !important; }
}
`

export function CelebrationOverlay({
  celebration,
  onDone,
  colors = ACCENT_ONLY,
  placement = 'bottom',
}: {
  celebration: Celebration
  onDone: () => void
  colors?: readonly string[]
  placement?: 'bottom' | 'top'
}) {
  useEffect(() => {
    haptic([20, 40, 20])
    const id = window.setTimeout(onDone, SHOWN_MS)
    return () => clearTimeout(id)
  }, [celebration.key, onDone])

  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, index) => ({
        left: `${(index * 37) % 100}%`,
        delay: `${(index % 7) * 0.09}s`,
        duration: `${1.6 + (index % 5) * 0.25}s`,
        drift: `${((index * 53) % 120) - 60}px`,
        spin: `${360 + ((index * 97) % 540)}deg`,
        color: colors[index % colors.length],
        size: 6 + (index % 3) * 2,
      })),
    [colors],
  )

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{KEYFRAMES}</style>
      {pieces.map((piece, index) => (
        <span
          key={index}
          aria-hidden
          className="te-confetti-piece pointer-events-none absolute top-0 rounded-[2px]"
          style={
            {
              left: piece.left,
              width: piece.size,
              height: piece.size * 1.6,
              background: piece.color,
              animation: `te-confetti-fall ${piece.duration} ease-in ${piece.delay} forwards`,
              '--drift': piece.drift,
              '--spin': piece.spin,
            } as React.CSSProperties
          }
        />
      ))}
      <button
        role="status"
        aria-label={celebration.title}
        onClick={onDone}
        className={`te-celebrate-pop pointer-events-auto absolute inset-x-4 ${placement === 'top' ? 'top-[calc(env(safe-area-inset-top)+72px)]' : 'bottom-[calc(env(safe-area-inset-bottom)+88px)]'} mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left shadow-xl ring-1 ring-line`}
        style={{ animation: 'te-celebrate-pop 420ms cubic-bezier(.2,.9,.3,1.3) both' }}
      >
        <span className="flex shrink-0 gap-0.5 text-[32px] leading-none">
          {celebration.icons.map((icon, index) => (
            <span key={index}>{icon}</span>
          ))}
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-bold tracking-tight">{celebration.title}</span>
          <span className="block truncate text-[12.5px] text-ink-muted">{celebration.subtitle}</span>
        </span>
      </button>
    </div>,
    document.body,
  )
}

export interface CelebrationState {
  badges: readonly CelebratedBadge[]
  level: number
  day: string
  dayComplete: boolean
}

function readCelebrated(storageKey: string): Celebrated | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Celebrated
  } catch (error) {
    console.warn('[celebrations] unreadable record, starting over', error)
    return null
  }
}

const QUIET_ONCE_KEY = 'celebrations.quiet-once'

export const quietNextCelebrations = (): void => sessionStorage.setItem(QUIET_ONCE_KEY, '1')

export function useCelebrations(
  storageKey: string | null,
  now: CelebrationState | null,
  { isQuiet = false }: { isQuiet?: boolean } = {},
) {
  const [queue, setQueue] = useState<Celebration[]>([])

  const signature =
    now === null
      ? null
      : [
          now.level,
          now.day,
          now.dayComplete,
          ...now.badges.filter((badge) => badge.earned).map((badge) => badge.key),
        ].join('|')

  useEffect(() => {
    if (now === null || storageKey === null) return
    const isQuietOnce = sessionStorage.getItem(QUIET_ONCE_KEY) !== null
    sessionStorage.removeItem(QUIET_ONCE_KEY)
    const { celebrations, next } = celebrationsSince(readCelebrated(storageKey), now)
    localStorage.setItem(storageKey, JSON.stringify(next))
    if (!isQuiet && !isQuietOnce && celebrations.length > 0) setQueue((current) => [...current, ...celebrations])
  }, [signature, storageKey, isQuiet])

  const pushed = useRef(0)
  const push = useCallback((celebration: Celebration) => {
    pushed.current += 1
    const key = `${celebration.key}#${pushed.current}`
    setQueue((current) => [...current, { ...celebration, key }])
  }, [])
  const dismiss = useCallback(() => setQueue((current) => current.slice(1)), [])

  return { current: queue[0] ?? null, push, dismiss }
}
