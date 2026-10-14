import type { ReactNode } from 'react'

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-xl px-3.5 py-2.5 text-[13.5px]"
      style={{
        background: 'color-mix(in srgb, var(--status-critical) 10%, transparent)',
        color: 'var(--status-critical)',
      }}
    >
      {children}
    </p>
  )
}
