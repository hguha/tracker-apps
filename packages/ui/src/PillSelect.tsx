import type { ReactNode } from 'react'
import { cn } from '@tracker-engine/core'

export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  isRequired = false,
  layout = 'fill',
  className,
}: {
  value: T | null
  options: { value: T; label: ReactNode }[]
  onChange: (value: T | null) => void
  isRequired?: boolean
  layout?: 'fill' | 'wrap'
  className?: string
}) {
  return (
    <div className={cn('flex gap-1.5', layout === 'wrap' && 'flex-wrap', className)}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            onClick={() => onChange(active && !isRequired ? null : option.value)}
            aria-pressed={active}
            className={cn(
              'rounded-lg font-semibold transition-colors',
              layout === 'fill' ? 'h-10 flex-1 text-[14px]' : 'h-9 px-3 text-[13px]',
              active ? 'bg-accent text-accent-contrast' : 'bg-sunken text-ink-secondary',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
