import { Card } from '@tracker-engine/ui'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import type { Suggestion } from './loggable'

function LoggableRow<T extends Suggestion>({
  suggestion,
  onPick,
}: {
  suggestion: T
  onPick: (suggestion: T) => void
}) {
  return (
    <button
      onClick={() => onPick(suggestion)}
      className="w-full px-4 py-2.5 text-left active:bg-sunken"
    >
      <span className="block truncate text-[14px]">{suggestion.title}</span>
      <span className="tabular mt-0.5 flex items-baseline gap-2">
        <span className="shrink-0 text-[12px] font-semibold">{suggestion.nutrients.kcal} kcal</span>
        <MacroNumbers nutrients={suggestion.nutrients} />
      </span>
      {suggestion.detail !== '' && (
        <span className="tabular block truncate text-[11.5px] text-ink-muted">
          {suggestion.detail}
        </span>
      )}
    </button>
  )
}

export function LoggableList<T extends Suggestion>({
  items,
  onPick,
  heading,
}: {
  items: readonly T[]
  onPick: (suggestion: T) => void
  heading?: string
}) {
  return (
    <Card className="overflow-hidden p-0">
      {heading && (
        <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {heading}
        </p>
      )}
      <ul className="divide-y divide-line">
        {items.map((suggestion) => (
          <li key={suggestion.key}>
            <LoggableRow suggestion={suggestion} onPick={onPick} />
          </li>
        ))}
      </ul>
    </Card>
  )
}
