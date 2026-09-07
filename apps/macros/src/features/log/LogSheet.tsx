import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ScanLine, Sparkles } from 'lucide-react'
import { BottomSheet, Button, useToast } from '@tracker-engine/ui'
import { isBarcodeScanningAvailable } from '@/platform/barcode'
import { searchRemote } from '@/data/foodLookup'
import { ScanPanel } from './ScanPanel'
import { DescribePanel } from './DescribePanel'
import { MealPicker } from './MealPicker'
import * as repo from '@/data/repository'
import { gramsToMg, nutrientsFor, portionFor } from '@/lib/nutrition'
import { EMPTY_NUTRIENTS, type Food, type MealSlot } from '@/domain/types'
import { grams } from '@/features/shared/format'

/**
 * The fast path. Search is offline over the seeded set, so the common case never waits on a
 * network call. Frequents come first with no query at all, because most people eat the same
 * thirty things.
 */
export function LogSheet({ meal, onDismiss }: { meal: MealSlot; onDismiss: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Food | null>(null)
  const [panel, setPanel] = useState<'search' | 'scan' | 'describe'>('search')
  const canScan = isBarcodeScanningAvailable()

  const results = useLiveQuery(() => repo.searchFoods(query), [query], [])

  // Local first, always. Only reach for the long tail when the seeded set comes up thin, and
  // never block on it: results already on screen must not disappear while a fetch is in
  // flight. Remote hits are cached locally, so the live query picks them up on its own.
  useEffect(() => {
    if (query.trim().length < 3 || (results?.length ?? 0) >= 5) return
    const id = window.setTimeout(() => void searchRemote(query), 400)
    return () => clearTimeout(id)
  }, [query, results?.length])
  const frequentIds = useLiveQuery(() => repo.frequentFoodIds(12), [], [])
  const frequents = useLiveQuery(
    async () => [...(await repo.foodsByIds(frequentIds ?? [])).values()],
    [frequentIds],
    [],
  )

  const shown = query.trim().length >= 2 ? (results ?? []) : (frequents ?? [])

  return (
    <BottomSheet onDismiss={onDismiss} panelClassName="flex max-h-[85%] flex-col">
      {panel === 'scan' ? (
        <ScanPanel
          // Leaving scan mode matters: the portion step renders in the same slot, so a found
          // barcode would otherwise stay stuck on the camera view.
          onFound={(food) => {
            setPanel('search')
            setSelected(food)
          }}
          onCancel={() => setPanel('search')}
        />
      ) : panel === 'describe' ? (
        <DescribePanel meal={meal} onBack={() => setPanel('search')} onDone={onDismiss} />
      ) : selected ? (
        <PortionStep
          food={selected}
          meal={meal}
          onBack={() => setSelected(null)}
          onDone={onDismiss}
        />
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search foods"
              className="min-w-0 flex-1 rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
            />
            {/* Hidden rather than shown-and-broken where BarcodeDetector is absent. */}
            {canScan && (
              <button
                onClick={() => setPanel('scan')}
                aria-label="Scan a barcode"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
              >
                <ScanLine size={20} />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {shown.length === 0 && (
              <p className="px-4 py-6 text-center text-[13.5px] text-ink-muted">
                {query.trim().length >= 2 ? 'Nothing matched.' : 'Search for a food to log it.'}
              </p>
            )}
            <ul className="divide-y divide-line">
              {shown.map((food) => (
                <li key={food.id}>
                  <button
                    onClick={() => setSelected(food)}
                    className="w-full px-4 py-2.5 text-left active:bg-sunken"
                  >
                    <div className="text-[14px]">{food.description}</div>
                    <div className="tabular text-[12px] text-ink-muted">
                      {food.brand ? `${food.brand} · ` : ''}
                      {food.per100.kcal} kcal / 100g
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Ahead of quick-add: describing a meal is the fast path for anything the search
              box can't name in one go, and it still resolves to real food rows. */}
          <button
            onClick={() => setPanel('describe')}
            className="flex items-center justify-center gap-2 border-t border-line py-3 text-[13.5px] font-semibold text-accent active:opacity-60"
          >
            <Sparkles size={15} />
            Describe a meal instead
          </button>

          <QuickAddRow meal={meal} onDone={onDismiss} />
        </>
      )}
    </BottomSheet>
  )
}

function PortionStep({
  food,
  meal,
  onBack,
  onDone,
}: {
  food: Food
  meal: MealSlot
  onBack: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const defaultPortion = portionFor(food, null)
  const [portionId, setPortionId] = useState<string | null>(defaultPortion?.id ?? null)
  const [count, setCount] = useState('1')
  const [gramsInput, setGramsInput] = useState('')
  const [slot, setSlot] = useState<MealSlot>(meal)

  const portion = portionFor(food, portionId)
  const resolvedGrams = gramsInput
    ? Number(gramsInput)
    : portion
      ? portion.grams * (Number(count) || 0)
      : 0
  const preview = nutrientsFor(food, resolvedGrams || 0)

  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-4 py-3">
        <button onClick={onBack} className="text-[13px] font-semibold text-accent">
          ← Back
        </button>
        <h2 className="mt-1 text-[16px] font-semibold tracking-tight">{food.description}</h2>
      </div>

      <div className="space-y-3 px-4 py-3">
        {food.portions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {food.portions.map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  setPortionId(option.id)
                  setGramsInput('')
                }}
                className={
                  option.id === portionId && !gramsInput
                    ? 'rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast'
                    : 'rounded-full bg-sunken px-3 py-1.5 text-[13px] text-ink-secondary'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="flex-1">
            <span className="text-[12px] text-ink-muted">Servings</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.25"
              value={count}
              onChange={(event) => {
                setCount(event.target.value)
                setGramsInput('')
              }}
              className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            />
          </label>
          <label className="flex-1">
            <span className="text-[12px] text-ink-muted">or grams</span>
            <input
              type="number"
              inputMode="numeric"
              value={gramsInput}
              onChange={(event) => setGramsInput(event.target.value)}
              placeholder={resolvedGrams ? String(Math.round(resolvedGrams)) : ''}
              className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
            />
          </label>
        </div>

        <p className="tabular text-[13px] text-ink-secondary">
          {preview.kcal} kcal · {grams(preview.proteinMg)}P {grams(preview.carbsMg)}C{' '}
          {grams(preview.fatMg)}F
        </p>

        <MealPicker value={slot} onChange={setSlot} />

        <Button
          className="w-full"
          disabled={resolvedGrams <= 0}
          onClick={() => {
            void repo
              .logFood(
                gramsInput
                  ? { food, meal: slot, grams: Number(gramsInput) }
                  : { food, meal: slot, portionId, portionCount: Number(count) },
              )
              .then(() => {
                toast.show(`Logged ${food.description}`)
                onDone()
              })
          }}
        >
          Log it
        </Button>
      </div>
    </div>
  )
}

/** For a label you have in hand but no database row: the escape hatch that stops someone
 *  abandoning the log entirely. */
function QuickAddRow({ meal, onDone }: { meal: MealSlot; onDone: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [slot, setSlot] = useState<MealSlot>(meal)
  const [fields, setFields] = useState({ kcal: '', protein: '', carbs: '', fat: '' })

  useEffect(() => {
    if (!open) setFields({ kcal: '', protein: '', carbs: '', fat: '' })
  }, [open])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border-t border-line py-3 text-[13.5px] font-semibold text-accent active:opacity-60"
      >
        Quick add macros
      </button>
    )
  }

  const numbers = {
    kcal: Number(fields.kcal) || 0,
    proteinMg: gramsToMg(Number(fields.protein) || 0),
    carbsMg: gramsToMg(Number(fields.carbs) || 0),
    fatMg: gramsToMg(Number(fields.fat) || 0),
  }

  return (
    <div className="space-y-2 border-t border-line px-4 py-3">
      <div className="grid grid-cols-4 gap-2">
        {(['kcal', 'protein', 'carbs', 'fat'] as const).map((field) => (
          <label key={field}>
            <span className="text-[11px] text-ink-muted">{field}</span>
            <input
              type="number"
              inputMode="numeric"
              value={fields[field]}
              onChange={(event) => setFields({ ...fields, [field]: event.target.value })}
              className="mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
            />
          </label>
        ))}
      </div>
      <MealPicker value={slot} onChange={setSlot} />
      <Button
        className="w-full"
        disabled={numbers.kcal <= 0}
        onClick={() => {
          void repo.logQuickAdd({ ...EMPTY_NUTRIENTS, ...numbers }, slot).then(() => {
            toast.show('Logged')
            onDone()
          })
        }}
      >
        Add
      </Button>
    </div>
  )
}
