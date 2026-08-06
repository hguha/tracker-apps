/**
 * The modal bottom sheet every overlay in the app is built on (§6.4, §7.3, §9).
 *
 * Before this, a dozen sheets each hand-rolled the same backdrop
 * (`fixed inset-0 z-50 flex flex-col justify-end bg-black/40`) and panel
 * (`rounded-t-3xl bg-surface pb-safe`). None dismissed on a backdrop tap or the
 * Escape key, and none locked body scroll — so the page behind them scrolled
 * under your finger. Centralizing fixes all three at once and for all of them.
 *
 * The panel's height and internal layout still vary (a short confirm vs a tall
 * scrolling list), so `panelClassName` is overridable; only the shell is fixed.
 */

import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

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
  /** id of the sheet's heading, wired to aria-labelledby for screen readers. */
  labelledBy?: string
}) {
  // Escape closes, matching the backdrop tap. Bound once while mounted.
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
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={dismissOnBackdrop ? onDismiss : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Stop taps inside the panel from bubbling to the backdrop's dismiss.
        onClick={(event) => event.stopPropagation()}
        className={cn('rounded-t-3xl bg-surface pb-safe', panelClassName)}
      >
        {children}
      </div>
    </div>
  )
}
