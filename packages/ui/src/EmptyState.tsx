import type { ReactNode } from 'react'
import { cn } from '@tracker-engine/core'

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('py-3', className)}>
      <p className="text-[14px] font-medium">{title}</p>
      {children && <p className="mt-0.5 text-[12.5px] text-ink-muted">{children}</p>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  )
}
