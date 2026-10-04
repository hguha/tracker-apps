import { useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@tracker-engine/core'

export interface SwipeAction {
  label: string
  icon: LucideIcon
  onAction: () => void
  /** `critical` paints it as a delete. Only for actions that lose something. */
  tone?: 'critical'
}

/** Per action. Wide enough for a finger, narrow enough that two fit without hiding the row. */
const ACTION_WIDTH = 68

/** Past this much drag the release opens rather than springs back. */
const OPEN_AT = 0.4

/** Below this a touch is a tap, or a scroll — engaging sooner makes the list impossible to scroll. */
const SLOP = 10

export function SwipeRow({
  actions,
  children,
  className,
}: {
  actions: readonly SwipeAction[]
  children: React.ReactNode
  className?: string
}) {
  const width = actions.length * ACTION_WIDTH
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const start = useRef<{ x: number; y: number; from: number; axis: 'none' | 'x' | 'y' } | null>(null)

  if (actions.length === 0) return <>{children}</>

  const close = () => setOffset(0)

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <div
        className="absolute inset-y-0 right-0 flex"
        style={{ width }}
        onFocus={() => setOffset(width)}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => {
              close()
              action.onAction()
            }}
            aria-label={action.label}
            className="flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold text-accent-contrast"
            style={{
              width: ACTION_WIDTH,
              background:
                action.tone === 'critical' ? 'var(--status-critical)' : 'var(--accent)',
            }}
          >
            <action.icon size={17} />
            {action.label}
          </button>
        ))}
      </div>

      <div
        className={cn('relative bg-surface', !isDragging && 'transition-transform duration-150')}
        style={{ transform: `translateX(${-offset}px)`, touchAction: 'pan-y' }}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          start.current = { x: event.clientX, y: event.clientY, from: offset, axis: 'none' }
        }}
        onPointerMove={(event) => {
          const from = start.current
          if (!from) return
          const dx = event.clientX - from.x
          const dy = event.clientY - from.y
          // The axis is decided once and then held. Deciding per-move makes a diagonal drag flicker
          // between scrolling the list and opening the row.
          if (from.axis === 'none') {
            if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
            from.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
          }
          if (from.axis !== 'x') return
          setIsDragging(true)
          setOffset(Math.max(0, Math.min(width, from.from - dx)))
        }}
        onPointerUp={() => {
          const from = start.current
          start.current = null
          setIsDragging(false)
          if (from?.axis !== 'x') return
          setOffset(offset > width * OPEN_AT ? width : 0)
        }}
        onPointerCancel={() => {
          start.current = null
          setIsDragging(false)
          setOffset(0)
        }}
      >
        {children}
        {/*
          While open, a tap on the row closes it rather than doing whatever the row does. Without this
          the first tap after a swipe opens a food you were about to delete.
        */}
        {offset > 0 && (
          <button
            onClick={close}
            aria-label="Close actions"
            tabIndex={-1}
            className="absolute inset-0 cursor-default"
          />
        )}
      </div>
    </div>
  )
}
