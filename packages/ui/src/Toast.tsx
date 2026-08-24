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
import { Undo2, X } from 'lucide-react'

interface ToastMessage {
  id: number
  text: string
  onUndo?: () => void
}

interface ToastApi {
  show: (text: string, onUndo?: () => void) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const VISIBLE_MS = 5000
/** Past this much horizontal travel, releasing dismisses. */
const DISMISS_THRESHOLD = 64

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((m) => m.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const show = useCallback(
    (text: string, onUndo?: () => void) => {
      const id = nextId.current++
      // Cap the stack: stale toasts covering the screen is worse than dropping the oldest.
      setMessages((current) => [...current.slice(-2), { id, text, onUndo }])
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), VISIBLE_MS),
      )
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center px-4 pt-safe">
        {messages.map((message) => (
          <Toast key={message.id} message={message} onDismiss={() => dismiss(message.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ message, onDismiss }: { message: ToastMessage; onDismiss: () => void }) {
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<'none' | 'horizontal' | 'vertical'>('none')

  function leave(direction: number) {
    setIsLeaving(true)
    setOffset(direction * 400)
    // Let the transform finish before unmounting, so it slides rather than blinks.
    window.setTimeout(onDismiss, 160)
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Don't hijack a tap on Undo.
    if ((event.target as HTMLElement).closest('button')) return
    start.current = { x: event.clientX, y: event.clientY }
    axis.current = 'none'
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y

    if (axis.current === 'none') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      // An upward flick also dismisses, since the toast sits at the top.
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      if (axis.current === 'vertical' && dy < -6) {
        start.current = null
        leave(0)
        return
      }
      if (axis.current === 'vertical') {
        start.current = null
        return
      }
      setIsDragging(true)
    }

    if (axis.current === 'horizontal') setOffset(dx)
  }

  function onPointerUp() {
    if (axis.current === 'horizontal') {
      if (Math.abs(offset) >= DISMISS_THRESHOLD) {
        leave(Math.sign(offset))
      } else {
        setOffset(0)
      }
    }
    start.current = null
    axis.current = 'none'
    setIsDragging(false)
  }

  const travel = Math.min(1, Math.abs(offset) / DISMISS_THRESHOLD)

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        transform: `translateX(${offset}px)`,
        opacity: isLeaving ? 0 : 1 - travel * 0.45,
        transition: isDragging ? 'none' : 'transform 160ms ease-out, opacity 160ms',
        touchAction: 'pan-y',
      }}
      className="animate-drop-in pointer-events-auto mt-2 flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-line-strong bg-surface/80 px-4 py-3 shadow-lg backdrop-blur-xl"
    >
      <span className="min-w-0 flex-1 text-[14px]">{message.text}</span>
      {message.onUndo ? (
        <button
          onClick={() => {
            message.onUndo?.()
            onDismiss()
          }}
          className="flex shrink-0 items-center gap-1.5 text-[14px] font-semibold text-accent"
        >
          <Undo2 size={15} />
          Undo
        </button>
      ) : (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <X size={15} />
        </button>
      )}
    </div>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside a ToastProvider')
  return api
}
