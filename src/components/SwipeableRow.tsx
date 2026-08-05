/**
 * Swipe-to-act row (§6.4).
 *
 * Hand-rolled on pointer events rather than pulled from a gesture library: the
 * behavior needed here is narrow, and the important part is what it *refuses*
 * to do — it must not steal vertical scrolling, and it must not fire while the
 * user is typing in a set field.
 *
 * Swipe left reveals the destructive action, swipe right the duplicate action.
 * Releasing past the threshold commits; anything short springs back.
 */

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'

const COMMIT_THRESHOLD = 72
/** Below this, treat the gesture as a tap and let it through untouched. */
const DRAG_START_THRESHOLD = 8
/** Past this much vertical movement it's a scroll, so bail out entirely. */
const VERTICAL_CANCEL_THRESHOLD = 12

export interface SwipeAction {
  label: string
  icon: ReactNode
  /** Background behind the revealed action. */
  className: string
  onAction: () => void
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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.pointerType === 'mouse') return
    // Typing in a set field should never be interrupted by a stray drag.
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select')) return
    start.current = { x: event.clientX, y: event.clientY }
    decided.current = 'none'
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
      setIsDragging(true)
    }

    if (decided.current !== 'horizontal') return

    // Don't let the row slide in a direction with nothing behind it.
    const clamped =
      dx < 0 ? (leftAction ? dx : 0) : rightAction ? dx : 0
    // Resist past the commit point so the threshold is felt, not guessed.
    const resisted =
      Math.abs(clamped) > COMMIT_THRESHOLD
        ? Math.sign(clamped) * (COMMIT_THRESHOLD + (Math.abs(clamped) - COMMIT_THRESHOLD) * 0.35)
        : clamped
    setOffset(resisted)
  }

  function onPointerUp() {
    if (decided.current === 'horizontal') {
      if (offset <= -COMMIT_THRESHOLD && leftAction) leftAction.onAction()
      else if (offset >= COMMIT_THRESHOLD && rightAction) rightAction.onAction()
    }
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
        onPointerCancel={onPointerUp}
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging ? 'none' : 'transform 180ms ease-out',
          // Let the browser own vertical scrolling; we only claim the x axis.
          touchAction: 'pan-y',
        }}
        className="relative bg-surface"
      >
        {children}
      </div>
    </div>
  )
}
