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
    <div className={cn('rounded-2xl border border-line bg-surface', className)}>
      {children}
    </div>
  )
}
