import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { portionWithGrams } from '@/features/shared/format'
import { NumberInput } from '@/features/shared/NumberInput'
import type { Food } from '@/domain/types'

const GRAMS = '__grams'

interface Unit {
  id: string
  label: string
  grams: number
}

function unitsFor(food: Food | null | undefined): Unit[] {
  const portions = (food?.portions ?? [])
    .filter((portion) => portion.grams > 0)
    .map((portion) => ({ id: portion.id, label: portionWithGrams(portion), grams: portion.grams }))
  return [{ id: GRAMS, label: 'grams', grams: 1 }, ...portions]
}

function readableUnit(grams: number, units: readonly Unit[]): string {
  if (grams <= 0) return GRAMS
  const measures = units.filter((unit) => unit.id !== GRAMS).sort((a, b) => b.grams - a.grams)
  for (const unit of measures) {
    const count = Math.round((grams / unit.grams) * 4) / 4
    if (count >= 0.25 && Math.abs(count * unit.grams - grams) <= grams * 0.02) return unit.id
  }
  return GRAMS
}

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
  const units = unitsFor(food)
  const [unitId, setUnitId] = useState(GRAMS)
  const unit = units.find((row) => row.id === unitId) ?? units[0]!

  const foodId = food?.id ?? null
  useEffect(() => {
    setUnitId(readableUnit(grams, unitsFor(food)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodId])

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
        {units.length > 1 ? (
          <select
            value={unit.id}
            onChange={(event) => setUnitId(event.target.value)}
            aria-label={`Unit for ${title}`}
            className="max-w-[112px] shrink-0 rounded-lg bg-sunken py-1.5 pl-1.5 text-[12px] text-ink-secondary outline-none"
          >
            {units.map((option) => (
              <option key={option.id} value={option.id}>
                {option.id === GRAMS ? 'g' : option.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[12px] text-ink-muted">g</span>
        )}
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
