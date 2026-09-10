import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { Button, ProgressRing, useToast } from '@tracker-engine/ui'
import { Minus, Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { dayTotals, mgToGrams, nutrientsFor, portionFor, sum } from '@/lib/nutrition'
import { portionLabel, portionWithGrams } from '@/features/shared/format'
import { MACRO_BARS } from '@/features/shared/MacroBar'
import type { Food, MacroTargets, Nutrients } from '@/domain/types'
import type { LogTarget } from './target'

/** The literal-grams option, alongside the food's own portions. */
const GRAMS = '__grams'

/**
 * How much of it, and what that does to the day.
 *
 * **One amount, one unit.** It used to have two live inputs — "Servings" and "or weigh it (g)" — where
 * writing in either silently cleared the other, so the number the app would actually use was a
 * precedence rule with no visual expression. A count plus a unit selector can only mean one thing.
 *
 * **The day, not just the food.** The screen showed a line of "240 kcal · 45gP 0gC 5gF" and then two
 * thirds of a blank page. The question at this moment is not what the food contains, it is whether it
 * fits — so the ring and the bars show the day as it will be once this is logged, with the part this
 * food adds drawn on top of what is already there.
 *
 * `isSaving` is not decoration: without it a second tap while the first write is in flight
 * logs the food twice, which is how three copies of a scanned barcode ended up in one day.
 */
export function PortionPanel({
  food,
  target,
  onDone,
}: {
  food: Food
  target: LogTarget
  onDone: () => void
}) {
  const toast = useToast()
  const defaultPortion = portionFor(food, null)
  // How much of this you had last time. The database's "1 serving" is wrong for nearly everyone on
  // nearly every food, and re-typing 180 g of chicken daily is the friction that ends a food diary.
  const last = useLiveQuery(() => repo.lastAmountFor(food.id), [food.id], undefined)

  // A food with no portions (most branded rows, any own food without a stated serving) starts in
  // grams, so it never opens on an empty box with a disabled button.
  const [unit, setUnit] = useState<string>(defaultPortion?.id ?? GRAMS)
  const [amount, setAmount] = useState<string>(defaultPortion ? '1' : '100')
  const [isEdited, setIsEdited] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Applied once, when the lookup lands, and never over something the user has already touched.
  useEffect(() => {
    if (isEdited || last === undefined || last === null) return
    if (last.portionId !== null && portionFor(food, last.portionId)) {
      setUnit(last.portionId)
      setAmount(String(last.portionCount ?? 1))
    } else {
      setUnit(GRAMS)
      setAmount(String(Math.round(last.grams)))
    }
  }, [food, isEdited, last])

  const portion = unit === GRAMS ? null : portionFor(food, unit)
  const count = Number(amount)
  const grams = !Number.isFinite(count) || count <= 0 ? 0 : portion ? portion.grams * count : count
  const adding = nutrientsFor(food, grams)

  const day = dayKey(target.at)
  const dayEntries = useLiveQuery(() => repo.entriesForDay(day), [day], [])
  /**
   * The same target the home screen shows.
   *
   * `targetsByDay` is check-in-governed and returns null for a day no check-in has covered yet — which
   * is every day of the first week. Using it here showed the no-target fallback on a screen where the
   * ring was the point, while Today two taps away showed "of 1,988". `currentTargets` is what Today
   * reads, so for today it is the answer; a past day keeps the target that actually governed it.
   */
  const isToday = day === dayKey(Date.now())
  const targets = useLiveQuery(
    async () =>
      isToday
        ? await repo.currentTargets()
        : ((await repo.targetsByDay([day])).get(day) ?? null),
    [day, isToday],
    null,
  )
  const already = dayTotals(dayEntries ?? [])
  const after = sum([already, adding])

  const step = portion ? 0.5 : grams >= 200 ? 25 : grams >= 50 ? 10 : 5
  const nudge = (delta: number) => {
    setIsEdited(true)
    const next = Math.max(portion ? 0.5 : 1, Math.round((count + delta) * 100) / 100)
    setAmount(String(next))
  }

  async function log() {
    if (isSaving || grams <= 0) return
    setIsSaving(true)
    try {
      await repo.logFood({
        food,
        meal: target.meal,
        eatenAt: target.at,
        venue: target.venue,
        source: food.barcode ? 'barcode' : 'search',
        ...(portion ? { portionId: portion.id, portionCount: count } : { grams }),
      })
      toast.show(`Logged ${food.description}`)
      onDone()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">{food.description}</h2>
        <p className="text-[12.5px] text-ink-muted">
          {food.brand ? `${food.brand} · ` : ''}
          {food.per100.kcal} kcal / 100 g
        </p>
      </div>

      {/* One amount, one unit. The unit list is the food's own portions plus grams, so what the app
          will use is always the pair on screen. */}
      <div className="flex items-stretch gap-2">
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-sunken p-1">
          <button
            onClick={() => nudge(-step)}
            aria-label="Less"
            className="flex size-9 items-center justify-center rounded-lg text-ink-secondary active:bg-page"
          >
            <Minus size={16} />
          </button>
          <input
            type="number"
            inputMode="decimal"
            step={portion ? '0.5' : '1'}
            value={amount}
            onChange={(event) => {
              setIsEdited(true)
              setAmount(event.target.value)
            }}
            aria-label="Amount"
            className="tabular w-14 bg-transparent text-center text-[17px] font-semibold outline-none"
          />
          <button
            onClick={() => nudge(step)}
            aria-label="More"
            className="flex size-9 items-center justify-center rounded-lg text-ink-secondary active:bg-page"
          >
            <Plus size={16} />
          </button>
        </div>

        <select
          value={unit}
          onChange={(event) => {
            setIsEdited(true)
            const next = event.target.value
            // Carry the weight across rather than the number: switching "2 slices" to grams should
            // land on 56 g, not on 2 g.
            const nextPortion = next === GRAMS ? null : portionFor(food, next)
            setAmount(
              next === GRAMS
                ? String(Math.max(1, Math.round(grams)))
                : String(Math.max(0.5, Math.round((grams / (nextPortion?.grams ?? 100)) * 2) / 2)),
            )
            setUnit(next)
          }}
          aria-label="Unit"
          className="min-w-0 flex-1 rounded-xl bg-sunken px-3 text-[14px] outline-none"
        >
          {food.portions.map((option) => (
            <option key={option.id} value={option.id}>
              {portionWithGrams(option)}
            </option>
          ))}
          <option value={GRAMS}>grams</option>
        </select>
      </div>

      <p className="tabular text-[12.5px] text-ink-muted">
        {grams > 0 ? `${Math.round(grams)} g` : 'Pick an amount'}
        {portion && ` · ${amount} × ${portionLabel(portion)}`}
        {last !== undefined && last !== null && !isEdited && ' · the amount you had last time'}
      </p>

      <DayPreview already={already} adding={adding} after={after} targets={targets} />

      <Button className="w-full" disabled={grams <= 0 || isSaving} onClick={() => void log()}>
        {isSaving ? 'Logging…' : `Log it · ${adding.kcal} kcal`}
      </Button>
    </div>
  )
}

/**
 * The day as it will be, with this food's share drawn on top of what is already there.
 *
 * Two segments per bar rather than one, because "does this fit" is a question about the *increment*:
 * a protein bar at 82% tells you nothing about whether the chicken you are about to log is what got it
 * there. Without a target there is nothing to fit inside, so it falls back to stating the day's totals
 * — still more use than the food's macros alone, which the row above already gave.
 */
function DayPreview({
  already,
  adding,
  after,
  targets,
}: {
  already: Nutrients
  adding: Nutrients
  after: Nutrients
  targets: MacroTargets | null
}) {
  if (!targets) {
    return (
      <div className="rounded-xl bg-sunken px-3 py-2.5">
        <p className="text-[11px] text-ink-muted">Your day, once this is logged</p>
        <p className="tabular mt-0.5 flex flex-wrap items-baseline gap-x-2.5 text-[13px]">
          <span className="font-semibold">{after.kcal} kcal</span>
          {MACRO_BARS.map((macro) => (
            <span key={macro.key} className="flex items-baseline gap-1">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: macro.color }}
                aria-hidden
              />
              {Math.round(mgToGrams(after[macro.key]))}g
            </span>
          ))}
        </p>
      </div>
    )
  }

  const left = targets.kcal - after.kcal

  return (
    <div className="rounded-xl bg-sunken p-3">
      <div className="flex items-center gap-3.5">
        <ProgressRing value={after.kcal} max={targets.kcal} size={78}>
          <div className="text-center">
            <div className="tabular text-[17px] font-bold leading-none">{after.kcal}</div>
            <div className="text-[10px] text-ink-muted">of {targets.kcal}</div>
          </div>
        </ProgressRing>

        <div className="min-w-0 flex-1 space-y-1.5">
          {MACRO_BARS.map((macro) => (
            <SplitBar
              key={macro.key}
              label={macro.label}
              alreadyMg={already[macro.key]}
              addingMg={adding[macro.key]}
              targetMg={targets[macro.key]}
              color={macro.color}
            />
          ))}
        </div>
      </div>

      <p className="mt-2.5 text-[12.5px]">
        {left >= 0 ? (
          <span className="text-ink-secondary">
            <span className="tabular font-semibold">{left} kcal</span> still free after this.
          </span>
        ) : (
          <span style={{ color: 'var(--target-over)' }}>
            <span className="tabular font-semibold">{Math.abs(left)} kcal</span> over target if you
            log this.
          </span>
        )}
      </p>
    </div>
  )
}

/** Already eaten, then this food's share on top, against the target. */
function SplitBar({
  label,
  alreadyMg,
  addingMg,
  targetMg,
  color,
}: {
  label: string
  alreadyMg: number
  addingMg: number
  targetMg: number
  color: string
}) {
  const pct = (mg: number) => (targetMg <= 0 ? 0 : Math.max(0, (mg / targetMg) * 100))
  const base = Math.min(100, pct(alreadyMg))
  // Clamped against what's left of the bar, so an overshoot doesn't push the segment off the end and
  // silently disappear — the total is spelled out beside it either way.
  const extra = Math.min(100 - base, pct(addingMg))

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-ink-secondary">{label}</span>
        <span className="tabular text-ink-muted">
          {Math.round(mgToGrams(alreadyMg + addingMg))} / {Math.round(mgToGrams(targetMg))}g
          {addingMg > 0 && (
            <span style={{ color }}> +{Math.round(mgToGrams(addingMg))}</span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-page">
        <span
          style={{ width: `${base}%`, background: `color-mix(in srgb, ${color} 34%, transparent)` }}
        />
        <span className={cn('transition-[width]')} style={{ width: `${extra}%`, background: color }} />
      </div>
    </div>
  )
}
