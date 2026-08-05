import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Surface container. A hairline ring rather than a shadow — quieter at scale. */
export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-surface',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('px-4 pt-3.5 pb-2', className)}>{children}</div>
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
}
