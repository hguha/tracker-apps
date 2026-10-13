import type { ReactNode } from 'react'

export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 pt-1">
      <h1 className="text-[22px] font-bold tracking-tight">{children}</h1>
      {aside}
    </div>
  )
}
