/**
 * Drag to reorder, drag-onto to superset (§6.4).
 *
 * Hand-rolled on pointer events for the same reason `SwipeableRow` is: the
 * behavior needed is narrow and specific, and the important part is what it
 * refuses to do — it must not fight vertical scrolling, and it must not trigger
 * while the user is typing in a set field.
 *
 * The interaction has two distinct drop outcomes, which is what makes an
 * off-the-shelf sortable list a poor fit:
 *   - Dropping in a *gap* between cards reorders.
 *   - Dropping *onto* a card's middle band supersets the two.
 *
 * The distinction is communicated before release: the drop target highlights and
 * captions what will happen, so the outcome is never a surprise.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

/** Fraction of a card's height, centered, that counts as "onto" rather than "between". */
const SUPERSET_BAND = 0.5

/** Hold this long before a drag begins, so a tap or a scroll is never a drag. */
const LONG_PRESS_MS = 260

export type DropIntent =
  | { kind: 'none' }
  | { kind: 'reorder'; index: number }
  | { kind: 'superset'; targetId: string }

interface DragState {
  activeId: string | null
  intent: DropIntent
}

interface DragApi extends DragState {
  registerItem: (id: string, element: HTMLElement | null) => void
  beginDrag: (id: string, event: ReactPointerEvent) => void
}

const DragContext = createContext<DragApi | null>(null)

export function useDragList(): DragApi {
  const api = useContext(DragContext)
  if (!api) throw new Error('useDragList must be used inside a DragList')
  return api
}

export function DragList({
  itemIds,
  onReorder,
  onSuperset,
  children,
}: {
  itemIds: string[]
  onReorder: (orderedIds: string[]) => void
  /**
   * Optional. When omitted, there is no superset gesture and the middle band
   * reorders like the rest — used by the template editor, where grouping isn't
   * offered and an accidental superset would be a surprise.
   */
  onSuperset?: (draggedId: string, targetId: string) => void
  children: ReactNode
}) {
  const [state, setState] = useState<DragState>({ activeId: null, intent: { kind: 'none' } })
  const elements = useRef(new Map<string, HTMLElement>())
  const pressTimer = useRef<number | null>(null)
  const isDragging = useRef(false)

  const registerItem = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element)
    else elements.current.delete(id)
  }, [])

  /** Where a release at this y-coordinate would land. */
  const resolveIntent = useCallback(
    (draggedId: string, clientY: number): DropIntent => {
      const boxes = itemIds
        .map((id) => {
          const element = elements.current.get(id)
          return element ? { id, rect: element.getBoundingClientRect() } : null
        })
        .filter((b): b is { id: string; rect: DOMRect } => b !== null)

      for (const [index, box] of boxes.entries()) {
        const { top, height } = box.rect
        if (clientY < top || clientY > top + height) continue

        if (box.id === draggedId) return { kind: 'none' }

        // The middle band supersets (when grouping is enabled); the outer thirds
        // reorder around the card. With no `onSuperset`, the whole card reorders.
        const offset = (clientY - top) / height
        const bandStart = (1 - SUPERSET_BAND) / 2
        if (onSuperset && offset > bandStart && offset < 1 - bandStart) {
          return { kind: 'superset', targetId: box.id }
        }
        return { kind: 'reorder', index: offset <= 0.5 ? index : index + 1 }
      }

      // Past the end of the list.
      const last = boxes[boxes.length - 1]
      if (last && clientY > last.rect.top + last.rect.height) {
        return { kind: 'reorder', index: boxes.length }
      }
      return { kind: 'none' }
    },
    [itemIds],
  )

  const finish = useCallback(
    (draggedId: string, intent: DropIntent) => {
      if (intent.kind === 'superset') {
        onSuperset?.(draggedId, intent.targetId)
      } else if (intent.kind === 'reorder') {
        const without = itemIds.filter((id) => id !== draggedId)
        const from = itemIds.indexOf(draggedId)
        // Removing the dragged item shifts later indices down by one.
        const to = intent.index > from ? intent.index - 1 : intent.index
        without.splice(to, 0, draggedId)
        if (without.join() !== itemIds.join()) onReorder(without)
      }
    },
    [itemIds, onReorder, onSuperset],
  )

  const beginDrag = useCallback(
    (id: string, event: ReactPointerEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, button')) return

      const startY = event.clientY
      const startX = event.clientX
      let currentIntent: DropIntent = { kind: 'none' }

      const onMove = (moveEvent: PointerEvent) => {
        if (!isDragging.current) {
          // Movement before the hold completes means the user is scrolling.
          const moved =
            Math.abs(moveEvent.clientY - startY) + Math.abs(moveEvent.clientX - startX)
          if (moved > 10 && pressTimer.current !== null) {
            clearTimeout(pressTimer.current)
            pressTimer.current = null
            cleanup()
          }
          return
        }
        moveEvent.preventDefault()
        currentIntent = resolveIntent(id, moveEvent.clientY)
        setState({ activeId: id, intent: currentIntent })
      }

      const onUp = () => {
        if (pressTimer.current !== null) {
          clearTimeout(pressTimer.current)
          pressTimer.current = null
        }
        if (isDragging.current) finish(id, currentIntent)
        cleanup()
      }

      const cleanup = () => {
        isDragging.current = false
        setState({ activeId: null, intent: { kind: 'none' } })
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      pressTimer.current = window.setTimeout(() => {
        isDragging.current = true
        setState({ activeId: id, intent: { kind: 'none' } })
        // A short buzz confirms the card is lifted, since the visual change is subtle.
        if ('vibrate' in navigator) navigator.vibrate(18)
      }, LONG_PRESS_MS)

      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [finish, resolveIntent],
  )

  const api = useMemo<DragApi>(
    () => ({ ...state, registerItem, beginDrag }),
    [state, registerItem, beginDrag],
  )

  return <DragContext.Provider value={api}>{children}</DragContext.Provider>
}

/**
 * Wraps one draggable card. Renders the reorder indicator and the superset
 * highlight, so the caller only supplies content.
 */
export function DragItem({
  id,
  index,
  supersetLabel,
  children,
}: {
  id: string
  index: number
  /** Shown while hovering this card as a superset target, e.g. "Bench Press". */
  supersetLabel?: string
  children: ReactNode
}) {
  const { activeId, intent, registerItem, beginDrag } = useDragList()

  const isActive = activeId === id
  const isSupersetTarget = intent.kind === 'superset' && intent.targetId === id
  const showLineAbove = intent.kind === 'reorder' && intent.index === index
  const showLineBelow =
    intent.kind === 'reorder' &&
    intent.index === index + 1 &&
    // Only the last card draws its own trailing line; others rely on the next
    // card's leading line, so a gap never shows two indicators.
    activeId !== null

  return (
    <div
      ref={(element) => registerItem(id, element)}
      onPointerDown={(event) => beginDrag(id, event)}
      className="relative"
      style={{
        // Lift the dragged card without removing it from the flow, so the list
        // doesn't jump at the moment the drag starts.
        opacity: isActive ? 0.5 : 1,
        transform: isActive ? 'scale(0.98)' : undefined,
        transition: 'opacity 120ms, transform 120ms',
        touchAction: activeId === null ? 'pan-y' : 'none',
      }}
    >
      {showLineAbove && <DropLine position="above" />}

      {isSupersetTarget && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 rounded-2xl ring-2"
            style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
          />
          <span className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-lg">
            Superset with {supersetLabel}
          </span>
        </>
      )}

      {children}

      {showLineBelow && <DropLine position="below" />}
    </div>
  )
}

function DropLine({ position }: { position: 'above' | 'below' }) {
  return (
    <span
      aria-hidden
      className={[
        'pointer-events-none absolute inset-x-2 z-30 h-0.5 rounded-full bg-accent',
        position === 'above' ? '-top-1.5' : '-bottom-1.5',
      ].join(' ')}
    />
  )
}
