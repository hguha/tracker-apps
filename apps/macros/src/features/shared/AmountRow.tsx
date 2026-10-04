import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { NumberInput } from '@/features/shared/NumberInput'
import { GRAMS, OUNCES, measuresFor, readableUnitId } from '@/features/shared/loggable'
import { GRAMS_PER_OZ } from '@/lib/nutrition'
import type { Food } from '@/domain/types'

export function AmountRow({
  title,
  subtitle,
  grams,
  onGrams,
  onRemove,
  after,
  food,
}: {
  title: string
  subtitle?: React.ReactNode
  grams: number
  onGrams: (grams: number) => void
  onRemove: () => void
  after?: React.ReactNode
  food?: Food | null
}) {
  const borrowed = useLiveQuery(
    async () => (food ? repo.borrowedPortions(food) : null),
    [food?.id],
    null,
  )
  const measures = food ? measuresFor(food, borrowed ?? null) : []
  const units = [
    { id: GRAMS, label: 'g', grams: 1 },
    { id: OUNCES, label: 'oz', grams: GRAMS_PER_OZ },
    ...measures,
  ]
  const [unitId, setUnitId] = useState(GRAMS)
  const unit = units.find((row) => row.id === unitId) ?? units[0]!

  const snapKey = `${food?.id ?? ''}:${borrowed?.from.id ?? ''}`
  useEffect(() => {
    setUnitId(readableUnitId(grams, measures))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey])

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">{title}</div>
          {subtitle !== undefined && <div className="text-[11.5px]">{subtitle}</div>}
        </div>
        <NumberInput
          value={grams / unit.grams}
          onValue={(value) => onGrams(Math.round(value * unit.grams))}
          aria-label={`Amount of ${title}`}
          className="tabular w-16 shrink-0 rounded-lg bg-sunken px-2 py-1.5 text-right text-[13.5px] outline-none"
        />
        <select
          value={unit.id}
          onChange={(event) => setUnitId(event.target.value)}
          aria-label={`Unit for ${title}`}
          className="max-w-[112px] shrink-0 rounded-lg bg-sunken py-1.5 pl-1.5 text-[12px] text-ink-secondary outline-none"
        >
          {units.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
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
