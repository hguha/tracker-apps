import { cn } from '@tracker-engine/core'

export function Switch({
  isOn,
  onChange,
  label,
}: {
  isOn: boolean
  onChange: (isOn: boolean) => void
  label: string
}) {
  return (
    <button
      onClick={() => onChange(!isOn)}
      aria-label={label}
      aria-pressed={isOn}
      className={cn(
        'h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors',
        isOn ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span
        className={cn(
          'block size-6 rounded-full bg-white shadow-sm transition-transform',
          isOn && 'translate-x-5',
        )}
      />
    </button>
  )
}
