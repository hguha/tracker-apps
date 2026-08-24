import { useEffect, type ReactNode } from 'react'
import { cn } from '@tracker-engine/core'

// Needs the `animate-fade-in` / `animate-rise` / `pb-safe` classes — an app either
// already defines them or imports @tracker-engine/ui/styles/base.css.
export function BottomSheet({
  onDismiss,
  children,
  panelClassName,
  /** A backdrop tap dismisses by default; opt out for a destructive confirm. */
  dismissOnBackdrop = true,
  labelledBy,
}: {
  onDismiss: () => void
  children: ReactNode
  panelClassName?: string
  dismissOnBackdrop?: boolean
  labelledBy?: string
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  // Lock the page behind the sheet so it doesn't scroll under the overlay.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={dismissOnBackdrop ? onDismiss : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Stop taps inside the panel from bubbling to the backdrop's dismiss.
        onClick={(event) => event.stopPropagation()}
        className={cn('animate-rise rounded-t-3xl bg-surface pb-safe', panelClassName)}
      >
        {children}
      </div>
    </div>
  )
}
