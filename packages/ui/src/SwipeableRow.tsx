// Swipe left/right on a row to reveal an action; release past the threshold to
// commit. A swipe may start anywhere on the row, including over a field or a button —
// those still tap when the gesture stays a tap (see useRowTap).

import {
  createContext,
  useContext,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '@tracker-engine/core'

const COMMIT_THRESHOLD = 72
const DRAG_START_THRESHOLD = 8
const VERTICAL_CANCEL_THRESHOLD = 12

export interface SwipeAction {
  label: string
  icon: ReactNode
  className: string
  onAction: () => void
}

// Whether the current gesture became a drag, so a control inside the row can tell a
// tap from a swipe that happened to start on it.
const RowGestureContext = createContext<{ current: boolean } | null>(null)

// Tap handling for a button inside a row. Commits on pointerup because a plain onClick
// after a row-handled pointer sequence is unreliable on iOS. Spread it on; don't also
// pass onClick, or a real mouse click fires twice.
export function useRowTap(onTap: () => void) {
  const didDrag = useContext(RowGestureContext)
  return {
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (didDrag?.current || event.pointerType === 'mouse') return
      onTap()
    },
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      // event.detail === 0 is a synthetic click (touch already handled it).
      if (didDrag?.current || event.detail === 0) return
      onTap()
    },
  }
}

export function SwipeableRow({
  children,
  leftAction,
  rightAction,
  disabled = false,
  className,
}: {
  children: ReactNode
  /** Revealed by swiping left (finger moves left). Usually destructive. */
  leftAction?: SwipeAction
  /** Revealed by swiping right. Usually duplicate. */
  rightAction?: SwipeAction
  disabled?: boolean
  className?: string
}) {
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const decided = useRef<'none' | 'horizontal' | 'vertical'>('none')
  const didDrag = useRef(false)
  // Set when a gesture starts on a field: focus is suppressed until we know it's a
  // tap, so a swipe that begins over an input doesn't pop the keyboard.
  const pendingFocus = useRef<HTMLElement | null>(null)

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.pointerType === 'mouse') return
    start.current = { x: event.clientX, y: event.clientY }
    decided.current = 'none'
    didDrag.current = false

    const field = (event.target as HTMLElement).closest<HTMLElement>('input, textarea')
    if (field && field !== document.activeElement) {
      pendingFocus.current = field
      event.preventDefault()
    } else {
      pendingFocus.current = null
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y

    if (decided.current === 'none') {
      if (Math.abs(dy) > VERTICAL_CANCEL_THRESHOLD) {
        decided.current = 'vertical'
        start.current = null
        return
      }
      if (Math.abs(dx) < DRAG_START_THRESHOLD) return
      decided.current = 'horizontal'
      didDrag.current = true
      pendingFocus.current = null
      setIsDragging(true)
    }

    if (decided.current !== 'horizontal') return

    // Don't let the row slide in a direction with nothing behind it.
    const clamped = dx < 0 ? (leftAction ? dx : 0) : rightAction ? dx : 0
    // Resist past the commit point so the threshold is felt, not guessed.
    const resisted =
      Math.abs(clamped) > COMMIT_THRESHOLD
        ? Math.sign(clamped) *
          (COMMIT_THRESHOLD + (Math.abs(clamped) - COMMIT_THRESHOLD) * 0.35)
        : clamped
    setOffset(resisted)
  }

  function onPointerUp() {
    if (decided.current === 'horizontal') {
      if (offset <= -COMMIT_THRESHOLD && leftAction) leftAction.onAction()
      else if (offset >= COMMIT_THRESHOLD && rightAction) rightAction.onAction()
    } else if (decided.current === 'none' && pendingFocus.current) {
      pendingFocus.current.focus()
    }
    reset()
  }

  function onPointerCancel() {
    // A scroll or system gesture took the pointer. Never focus on a cancel.
    reset()
  }

  function reset() {
    pendingFocus.current = null
    start.current = null
    decided.current = 'none'
    setIsDragging(false)
    setOffset(0)
  }

  const revealed = offset < 0 ? leftAction : offset > 0 ? rightAction : undefined
  const isPastThreshold = Math.abs(offset) >= COMMIT_THRESHOLD

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {revealed && (
        <div
          className={cn(
            'absolute inset-0 flex items-center px-5 text-white',
            offset < 0 ? 'justify-end' : 'justify-start',
            revealed.className,
          )}
        >
          <span
            className={cn(
              'flex items-center gap-1.5 text-[13px] font-semibold transition-opacity',
              isPastThreshold ? 'opacity-100' : 'opacity-60',
            )}
          >
            {revealed.icon}
            {revealed.label}
          </span>
        </div>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging ? 'none' : 'transform 180ms ease-out',
          touchAction: 'pan-y',
        }}
        className="relative touch-pan-y bg-surface"
      >
        <RowGestureContext.Provider value={didDrag}>{children}</RowGestureContext.Provider>
      </div>
    </div>
  )
}
