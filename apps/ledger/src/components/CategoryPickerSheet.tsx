import { BottomSheet } from '@tracker-engine/ui'
import { Check } from 'lucide-react'
import type { Category } from '@/domain/types'
import { cn } from '@/lib/cn'

// Presentational category chooser. The feature wires `onPick` to the repository, so
// this stays a pure component (no data-layer import).
export function CategoryPickerSheet({
  categories,
  currentId,
  onPick,
  onClose,
}: {
  categories: Category[]
  currentId: string | null
  onPick: (categoryId: string | null) => void
  onClose: () => void
}) {
  return (
    <BottomSheet onDismiss={onClose} labelledBy="cat-picker-title">
      <h2 id="cat-picker-title" className="px-1 pb-2 text-sm font-semibold text-ink-muted">
        Category
      </h2>
      <div className="max-h-[60vh] overflow-y-auto">
        {categories.map((c) => (
          <Row
            key={c.id}
            label={`${c.icon} ${c.name}`}
            color={c.color}
            selected={c.id === currentId}
            onClick={() => onPick(c.id)}
          />
        ))}
        <Row
          label="Uncategorized"
          color="var(--cat-uncategorized)"
          selected={currentId === null}
          onClick={() => onPick(null)}
        />
      </div>
    </BottomSheet>
  )
}

function Row({
  label,
  color,
  selected,
  onClick,
}: {
  label: string
  color: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-sunken',
        selected && 'bg-accent-wash',
      )}
    >
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="flex-1 text-ink">{label}</span>
      {selected && <Check size={18} className="text-accent" />}
    </button>
  )
}
