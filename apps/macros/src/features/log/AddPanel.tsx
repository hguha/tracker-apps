import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { Button, ProgressRing, useToast } from '@tracker-engine/ui'
import { Minus, Plus } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { dayTotals, mgToGrams, scale, sum } from '@/lib/nutrition'
import { MACRO_BARS } from '@/features/shared/MacroBar'
import type { MacroTargets, Nutrients } from '@/domain/types'
import { describeLoggable, partsOf, GRAMS, type Loggable, type LoggablePart } from './loggable'
import type { LogTarget } from './target'

/**
 * How much of it, and what that does to the day. **One screen for everything loggable.**
 *
 * A food, a recipe, a saved meal and a repeat of last night's dinner all used to be added through
 * different controls — a portion picker, a servings stepper, a 0.5×/2× sheet, and a bare "Log"
 * button that wrote six rows with no confirmation. The question is the same in all four cases, so
 * the answer is one screen and `loggable.ts` describes the differences.
 *
 * **The day, not just the food.** It showed a line of "240 kcal · 45gP 0gC 5gF" and then two thirds
 * of a blank page. The question at this moment is not what the food contains, it is whether it fits —
 * so the ring and the bars show the day as it will be once this is logged, with the part this adds
 * drawn on top of what is already there.
 *
 * `isSaving` is not decoration: without it a second tap while the first write is in flight logs the
 * food twice, which is how three copies of a scanned barcode ended up in one day.
 */
export function AddPanel({
  loggable,
  target,
  onDone,
}: {
  loggable: Loggable
  target: LogTarget
  /** Given the number of rows written, so the log screen's counter is right for a whole recipe. */
  onDone: (count: number) => void
}) {
  const toast = useToast()
  const subject = describeLoggable(loggable)
  const key = subjectKey(loggable)

  // How much of this you had last time. The database's "1 serving" is wrong for nearly everyone on
  // nearly every food, and re-typing 180 g of chicken daily is the friction that ends a food diary.
  const last = useLiveQuery(
    () => (loggable.kind === 'food' ? repo.lastAmountFor(loggable.food.id) : Promise.resolve(null)),
    [key],
    undefined,
  )

  const [unitId, setUnitId] = useState(subject.initialUnitId)
  const [amount, setAmount] = useState(() => String(subject.initialUnitId === GRAMS ? 100 : 1))
  const [isEdited, setIsEdited] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Applied once, when the lookup lands, and never over something the user has already touched.
  useEffect(() => {
    if (isEdited || last === undefined || last === null) return
    const named = last.portionId === null ? null : subject.units.find((u) => u.id === last.portionId)
    if (named) {
      setUnitId(named.id)
      setAmount(String(last.portionCount ?? 1))
    } else {
      setUnitId(GRAMS)
      setAmount(String(Math.round(last.grams)))
    }
  }, [key, isEdited, last])

  const unit = subject.units.find((row) => row.id === unitId) ?? subject.units[0]!
  const typed = Number(amount)
  const count = !Number.isFinite(typed) || typed <= 0 ? 0 : typed
  const adding = count === 0 ? null : unit.nutrientsAt(count)

  const day = dayKey(target.at)
  /**
   * `undefined` until loaded, never `[]` or `null`.
   *
   * Both of these feed the "does it fit" panel, and both have a resting value that reads as a fact:
   * an empty day, and no target at all. Given `null`, this screen showed "Your day, once this is
   * logged" — the no-target fallback — for the first frame after every tap, on an account that has
   * a perfectly good target two taps away on Today.
   */
  const dayEntries = useLiveQuery(() => repo.entriesForDay(day), [day], undefined)
  /**
   * The same target the home screen shows.
   *
   * `targetsByDay` is check-in-governed and returns null for a day no check-in has covered yet —
   * which is every day of the first week. Using it here showed the no-target fallback on a screen
   * where the ring was the point, while Today two taps away showed "of 1,988". `currentTargets` is
   * what Today reads, so for today it is the answer; a past day keeps the target that governed it.
   */
  const isToday = day === dayKey(Date.now())
  const targets = useLiveQuery(
    async () =>
      isToday ? await repo.currentTargets() : ((await repo.targetsByDay([day])).get(day) ?? null),
    [day, isToday],
    undefined,
  )
  const parts = useLiveQuery(() => partsOf(loggable), [key], undefined)

  const isDayLoaded = dayEntries !== undefined && targets !== undefined
  const already = dayTotals(dayEntries ?? [])
  const after = adding ? sum([already, adding]) : already

  const nudge = (delta: number) => {
    setIsEdited(true)
    setAmount(String(Math.max(unit.min, Math.round((count + delta) * 100) / 100)))
  }

  async function log() {
    if (isSaving || count === 0) return
    setIsSaving(true)
    try {
      const written = await subject.log(unit, count, target)
      toast.show(written === 0 ? 'Nothing to log' : `Logged ${subject.title}`)
      if (written > 0) onDone(written)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight">{subject.title}</h2>
        <p className="text-[12.5px] text-ink-muted">{subject.subtitle}</p>
      </div>

      {/* One amount, one unit. It used to have two live inputs — "Servings" and "or weigh it (g)" —
          where writing in either silently cleared the other, so the number the app would actually
          use was a precedence rule with no visual expression. */}
      <div className="flex items-stretch gap-2">
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-sunken p-1">
          <button
            onClick={() => nudge(-unit.step)}
            aria-label="Less"
            className="flex size-9 items-center justify-center rounded-lg text-ink-secondary active:bg-page"
          >
            <Minus size={16} />
          </button>
          <input
            type="number"
            inputMode="decimal"
            step={unit.step}
            value={amount}
            onChange={(event) => {
              setIsEdited(true)
              setAmount(event.target.value)
            }}
            aria-label="Amount"
            className="tabular w-14 bg-transparent text-center text-[17px] font-semibold outline-none"
          />
          <button
            onClick={() => nudge(unit.step)}
            aria-label="More"
            className="flex size-9 items-center justify-center rounded-lg text-ink-secondary active:bg-page"
          >
            <Plus size={16} />
          </button>
        </div>

        {subject.units.length > 1 ? (
          <select
            value={unit.id}
            onChange={(event) => {
              setIsEdited(true)
              const next = subject.units.find((row) => row.id === event.target.value)
              if (!next) return
              // Carry the weight across rather than the number: switching "2 slices" to grams
              // should land on 56 g, not on 2 g.
              const weight = unit.gramsAt(count)
              const one = next.gramsAt(1)
              setAmount(
                weight === null || one === null || one <= 0
                  ? String(Math.max(next.min, count))
                  : String(Math.max(next.min, Math.round((weight / one) * 2) / 2)),
              )
              setUnitId(next.id)
            }}
            aria-label="Unit"
            className="min-w-0 flex-1 rounded-xl bg-sunken px-3 text-[14px] outline-none"
          >
            {subject.units.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex min-w-0 flex-1 items-center rounded-xl bg-sunken px-3 text-[14px] text-ink-secondary">
            {unit.label}
          </span>
        )}
      </div>

      <p className="tabular text-[12.5px] text-ink-muted">
        {count === 0 ? 'Pick an amount' : unit.summaryAt(count)}
        {last !== undefined && last !== null && !isEdited && ' · what you had last time'}
      </p>

      {isDayLoaded ? (
        <DayPreview already={already} adding={adding} after={after} targets={targets ?? null} />
      ) : (
        // A placeholder of roughly the right height, so the panel doesn't jump when it lands.
        <div className="h-[122px] rounded-xl bg-sunken" aria-hidden />
      )}

      {/* What's in it. A saved meal nobody remembers the contents of is one nobody dares log. */}
      {subject.isComposite && parts !== undefined && parts.length > 0 && (
        <div className="rounded-xl bg-sunken/60 px-3 py-2">
          <ul className="divide-y divide-line">
            {parts.map((part, index) => (
              <PartRow key={index} part={part} count={count} />
            ))}
          </ul>
        </div>
      )}

      <Button className="w-full" disabled={count === 0 || isSaving} onClick={() => void log()}>
        {isSaving ? 'Logging…' : `Log it · ${adding?.kcal ?? 0} kcal`}
      </Button>
    </div>
  )
}

/** Identity for the effects and queries: a different subject must not inherit the last one's state. */
function subjectKey(loggable: Loggable): string {
  switch (loggable.kind) {
    case 'food':
      return `food:${loggable.food.id}`
    case 'recipe':
      return `recipe:${loggable.recipe.id}`
    case 'meal':
      return `meal:${loggable.template.id}`
    case 'dish':
      return `dish:${loggable.dish.dishId}`
  }
}

function PartRow({ part, count }: { part: LoggablePart; count: number }) {
  const scaled = scale(part.nutrients, count)
  return (
    <li className="flex items-baseline gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{part.label}</span>
      {part.grams > 0 && (
        <span className="tabular shrink-0 text-[11px] text-ink-muted">
          {Math.round(part.grams * count)}g
        </span>
      )}
      <span className="tabular w-9 shrink-0 text-right text-[12px]">{scaled.kcal}</span>
    </li>
  )
}

/**
 * The day as it will be, with this addition drawn on top of what is already there.
 *
 * Two segments per bar rather than one, because "does this fit" is a question about the *increment*:
 * a protein bar at 82% tells you nothing about whether the chicken you are about to log is what got
 * it there. Without a target there is nothing to fit inside, so it falls back to stating the day's
 * totals — still more use than the item's macros alone, which the row above already gave.
 */
function DayPreview({
  already,
  adding,
  after,
  targets,
}: {
  already: Nutrients
  adding: Nutrients | null
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
              addingMg={adding?.[macro.key] ?? 0}
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

/** Already eaten, then this addition on top, against the target. */
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
          {addingMg > 0 && <span style={{ color }}> +{Math.round(mgToGrams(addingMg))}</span>}
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
