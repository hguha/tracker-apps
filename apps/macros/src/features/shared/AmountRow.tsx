import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { portionWithGrams } from '@/features/shared/format'
import type { Food } from '@/domain/types'

/**
 * One weighed component of something: a name, an editable amount, and a way to drop it.
 *
 * Used by both editable ingredient lists — a recipe's, and a draft estimate's — which are the same
 * interaction and were separately built twice.
 *
 * **Grams is what gets stored; it is not what people measure.** This row offered grams and nothing
 * else, so a bowl of chili could only be corrected as "383 g" when the honest answer is "about a cup
 * and a half" — and 1,401 of the seeded foods carry a cup, a tablespoon or a slice with a real weight
 * behind it. Picking one of those converts here and stores the grams, so nothing downstream learns a
 * new unit and no second basis can drift from the first.
 */
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

/** Two decimals at most, and no trailing zeros: 1.5 cups, not 1.50. */
const show = (value: number): string => String(Math.round(value * 100) / 100)

/**
 * The unit this weight is most readable in.
 *
 * A recipe line parsed from "1 cup rice" stores exactly 158 g, and the model's guess at a bowl of
 * chili stores 383 g against a 255 g cup — so both are a clean amount of a portion the food already
 * carries, and opening on grams hides that. Largest portion first, because cups beat tablespoons, and
 * only when the weight really is a near-multiple of it: anything else opens in grams, which is always
 * true if not always meaningful.
 */
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
  /** Rendered under the row, full width — used to fix a row that matched nothing. */
  after?: React.ReactNode
  /** The matched food, when there is one. Its portions become the units on offer. */
  food?: Food | null
}) {
  const units = unitsFor(food)
  const [unitId, setUnitId] = useState(GRAMS)
  const unit = units.find((row) => row.id === unitId) ?? units[0]!

  /**
   * Snapped once the food is known, and once only.
   *
   * The food arrives from a live query, so the first render has none and the readable unit is grams by
   * default — initial state alone would keep it there forever. And it must not be *re*-derived while
   * the amount is being typed: 2 cups is a clean multiple and 1.9 is not, so recomputing per keystroke
   * would silently change the unit under the cursor and reinterpret what had just been typed.
   */
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
        <input
          type="number"
          inputMode="decimal"
          value={show(grams / unit.grams)}
          onChange={(event) =>
            onGrams(Math.max(0, Math.round((Number(event.target.value) || 0) * unit.grams)))
          }
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
