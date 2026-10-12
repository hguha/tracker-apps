import type { ReactNode } from 'react'
import { cn } from '@tracker-engine/core'

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-[12px] font-semibold uppercase tracking-wide text-ink-muted', className)}>
      {children}
    </h3>
  )
}
