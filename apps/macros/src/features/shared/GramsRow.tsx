import { Trash2 } from 'lucide-react'

/**
 * One weighed component of something: a name, an editable gram figure, and a way to drop it.
 *
 * Used by both editable ingredient lists — a recipe's, and a draft estimate's — which are the same
 * interaction and were separately built twice. The gram field is the only editable number in either
 * case, because grams is what the app stores; everything else is derived from it.
 */
export function GramsRow({
  title,
  subtitle,
  grams,
  onGrams,
  onRemove,
  after,
}: {
  title: string
  subtitle?: React.ReactNode
  grams: number
  onGrams: (grams: number) => void
  onRemove: () => void
  /** Rendered under the row, full width — used to fix a row that matched nothing. */
  after?: React.ReactNode
}) {
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">{title}</div>
          {subtitle !== undefined && <div className="text-[11.5px]">{subtitle}</div>}
        </div>
        <input
          type="number"
          inputMode="numeric"
          value={grams}
          onChange={(event) => onGrams(Math.max(0, Number(event.target.value) || 0))}
          aria-label={`Grams of ${title}`}
          className="tabular w-16 shrink-0 rounded-lg bg-sunken px-2 py-1.5 text-right text-[13.5px] outline-none"
        />
        <span className="text-[12px] text-ink-muted">g</span>
        <button
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {after !== undefined && <div className="mt-1.5">{after}</div>}
    </li>
  )
}
