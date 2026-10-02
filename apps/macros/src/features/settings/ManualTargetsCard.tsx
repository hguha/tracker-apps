import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card } from '@tracker-engine/ui'
import { ChevronDown } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@tracker-engine/core'
import { gramsToMg, mgToGrams } from '@/lib/nutrition'
import type { MacroTargets } from '@/domain/types'

/**
 * Typing the targets in.
 *
 * Everything else on this screen chooses *inputs* — a direction, a pace, a protein floor — and lets
 * the check-in work out the numbers, which is the right default and is why the calories are measured
 * rather than picked. It is not the only legitimate way to want this: a coach's plan, a training
 * block, or a number that has worked before are all answers somebody already has, and the app had no
 * way to accept one. So this sits below the automatic version, collapsed, and says plainly what it
 * turns off.
 *
 * Collapsed and last on purpose. An override offered as prominently as the thing it overrides invites
 * people to guess a calorie target on day one, which is the exact mistake this app exists to avoid.
 */
export function ManualTargetsCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const computed = useLiveQuery(() => repo.currentTargets(), [], undefined)
  const [isOpen, setIsOpen] = useState(false)
  if (!profile) return null

  const manual = profile.manualTargets
  const summary = manual
    ? `${manual.kcal} kcal · ${Math.round(mgToGrams(manual.proteinMg))}P ${Math.round(mgToGrams(manual.carbsMg))}C ${Math.round(mgToGrams(manual.fatMg))}F`
    : 'Off — the check-in sets them'

  return (
    <Card className="p-0">
      <button
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">Set the targets myself</span>
          <span className="tabular block truncate text-[12.5px] text-ink-muted">{summary}</span>
        </span>
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="border-t border-line px-4 py-3">
          <Editor
            // Keyed on what's stored, so saving or clearing re-reads the fields rather than leaving
            // the old text in them.
            key={manual ? `${manual.kcal}:${manual.fromDay}` : 'auto'}
            start={manual ?? computed ?? null}
            isOverriding={manual !== null}
          />
        </div>
      )}
    </Card>
  )
}

function Editor({
  start,
  isOverriding,
}: {
  /** What to prefill: the override if there is one, otherwise the measured target. */
  start: MacroTargets | null
  isOverriding: boolean
}) {
  const [kcal, setKcal] = useState(start ? String(start.kcal) : '')
  const [protein, setProtein] = useState(start ? String(Math.round(mgToGrams(start.proteinMg))) : '')
  const [carbs, setCarbs] = useState(start ? String(Math.round(mgToGrams(start.carbsMg))) : '')
  const [fat, setFat] = useState(start ? String(Math.round(mgToGrams(start.fatMg))) : '')

  const numbers = {
    kcal: Math.round(Number(kcal)),
    proteinMg: gramsToMg(Number(protein)),
    carbsMg: gramsToMg(Number(carbs)),
    fatMg: gramsToMg(Number(fat)),
  }
  const isValid =
    Number.isFinite(numbers.kcal) &&
    numbers.kcal > 0 &&
    [protein, carbs, fat].every((value) => value.trim() !== '' && Number.isFinite(Number(value)))

  /**
   * What the macros come to, against what was typed as the calorie figure.
   *
   * Shown rather than enforced. Protein is 4 kcal/g by convention and food labels round, so insisting
   * the two agree exactly would reject perfectly sensible plans — but a split that comes to 2,900
   * against a 2,200 target is a typo, and nothing on screen would otherwise say so.
   */
  const fromMacros = Math.round(
    mgToGrams(numbers.proteinMg) * 4 + mgToGrams(numbers.carbsMg) * 4 + mgToGrams(numbers.fatMg) * 9,
  )
  const drift = isValid ? fromMacros - numbers.kcal : 0

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <Field label="kcal" value={kcal} onChange={setKcal} />
        <Field label="protein g" value={protein} onChange={setProtein} />
        <Field label="carbs g" value={carbs} onChange={setCarbs} />
        <Field label="fat g" value={fat} onChange={setFat} />
      </div>

      {isValid && Math.abs(drift) > 50 && (
        <p className="tabular text-[12px]" style={{ color: 'var(--status-serious)' }}>
          Those macros come to {fromMacros} kcal, not {numbers.kcal}.
        </p>
      )}

      <Button
        className="w-full"
        disabled={!isValid}
        onClick={() => void repo.setManualTargets(numbers)}
      >
        {isOverriding ? 'Update these targets' : 'Use these instead'}
      </Button>

      {isOverriding && (
        <button
          onClick={() => void repo.setManualTargets(null)}
          className="w-full py-1 text-[12.5px] font-semibold text-accent active:opacity-60"
        >
          Use the measured target instead
        </button>
      )}

      <p className="text-[12px] text-ink-muted">
        Applies from today. Past days keep their targets.
      </p>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="block truncate text-[11px] text-ink-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tabular mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-center text-[15px] outline-none"
      />
    </label>
  )
}
