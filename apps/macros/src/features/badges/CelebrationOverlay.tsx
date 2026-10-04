import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@tracker-engine/platform'
import type { Celebration } from './progression'

const PIECES = 28
const COLORS = [
  'var(--accent)',
  'var(--macro-protein)',
  'var(--macro-carbs)',
  'var(--macro-fat)',
  'var(--macro-fiber)',
]
const SHOWN_MS = 3_500

export function CelebrationOverlay({
  celebration,
  onDone,
}: {
  celebration: Celebration
  onDone: () => void
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
        color: COLORS[index % COLORS.length],
        size: 6 + (index % 3) * 2,
      })),
    [],
  )

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((piece, index) => (
        <span
          key={index}
          aria-hidden
          className="confetti-piece pointer-events-none absolute top-0 rounded-[2px]"
          style={
            {
              left: piece.left,
              width: piece.size,
              height: piece.size * 1.6,
              background: piece.color,
              animation: `confetti-fall ${piece.duration} ease-in ${piece.delay} forwards`,
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
        className="celebrate-pop pointer-events-auto absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+88px)] mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left shadow-xl ring-1 ring-line"
        style={{ animation: 'celebrate-pop 420ms cubic-bezier(.2,.9,.3,1.3) both' }}
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
