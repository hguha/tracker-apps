import { cn } from '@tracker-engine/core'

// A single-select row of pills that can be cleared back to null by tapping the
// active pill — for optional, small-cardinality choices.
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T | null
  options: { value: T; label: string }[]
  onChange: (value: T | null) => void
  className?: string
}) {
  return (
    <div className={cn('flex gap-1.5', className)}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            onClick={() => onChange(active ? null : option.value)}
            className={cn(
              'h-10 flex-1 rounded-lg text-[14px] font-semibold transition-colors',
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
