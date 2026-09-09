import { Card, ProgressRing } from '@tracker-engine/ui'
import { MACRO_META, grams } from '@/features/shared/format'
import { macroSharePct } from '@/lib/nutrition'
import { formatDuration, windowProgress, windowState } from '@/lib/mealTiming'
import type { EatingWindow, LogEntry, MacroTargets, Nutrients } from '@/domain/types'
import { MacroBar } from './MacroBar'

/**
 * The day's budget: what's gone, what's left, and — only for people who keep an eating window —
 * whether they're ahead or behind for the time of day.
 *
 * Pacing is deliberately withheld otherwise. Without knowing when someone eats, "you're behind
 * on calories" at 3pm is a guess dressed as advice, and the app has no business nagging someone
 * who simply eats late.
 */
export function BudgetCard({
  totals,
  targets,
  left,
  window,
  entries,
  missing,
  onFix,
}: {
  totals: Nutrients
  targets: MacroTargets | null
  left: MacroTargets | null
  window: EatingWindow | null
  entries: readonly LogEntry[]
  /** What the app still needs before it can set a first target. */
  missing: string[]
  onFix: () => void
}) {
  const shares = macroSharePct(totals)

  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <ProgressRing value={totals.kcal} max={targets?.kcal ?? 0} size={92}>
          <div className="text-center">
            <div className="tabular text-[20px] font-bold leading-none">{totals.kcal}</div>
            <div className="text-[10.5px] text-ink-muted">
              {targets ? `of ${targets.kcal}` : 'kcal'}
            </div>
          </div>
        </ProgressRing>

        <div className="flex-1 space-y-2.5">
          {MACRO_META.map((macro) => (
            <MacroBar
              key={macro.key}
              label={macro.label}
              eatenMg={totals[macro.key]}
              targetMg={targets?.[macro.key] ?? 0}
              sharePct={shares[macro.key]}
              barClassName={macro.bar}
            />
          ))}
        </div>
      </div>

      {left && targets ? (
        <p className="mt-3 text-[13px] text-ink-secondary">
          {left.kcal >= 0
            ? `${left.kcal} kcal and ${grams(Math.max(0, left.proteinMg))} protein left.`
            : `${Math.abs(left.kcal)} kcal over target.`}
          {window && <Pacing window={window} targets={targets} totals={totals} entries={entries} />}
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-[13px] text-ink-secondary">
            {missing.length > 0
              ? `No target yet — the first one needs your ${joinWords(missing)}.`
              : 'No target yet — pick a goal to get one.'}
          </p>
          <button
            onClick={onFix}
            className="mt-2 w-full rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
          >
            {missing.length > 0 ? 'Fill that in' : 'Choose a goal'}
          </button>
        </div>
      )}
    </Card>
  )
}

function Pacing({
  window,
  targets,
  totals,
  entries,
}: {
  window: EatingWindow
  targets: MacroTargets
  totals: Nutrients
  entries: readonly LogEntry[]
}) {
  const state = windowState(window, entries)

  if (state.phase === 'before') {
    return (
      <span className="text-ink-muted">
        {' '}
        Window opens in {formatDuration(state.opensInMinutes ?? 0)}
        {state.fastedMinutes !== null && ` · fasted ${formatDuration(state.fastedMinutes)}`}.
      </span>
    )
  }

  if (state.phase === 'after') {
    return <span className="text-ink-muted"> Window closed for today.</span>
  }

  const expected = Math.round(targets.kcal * windowProgress(window))
  const drift = totals.kcal - expected
  const label =
    Math.abs(drift) < 150
      ? 'On pace for this time of day'
      : drift < 0
        ? `${Math.abs(drift)} kcal behind pace`
        : `${drift} kcal ahead of pace`

  return (
    <span className="text-ink-muted">
      {' '}
      {label} · {formatDuration(state.closesInMinutes ?? 0)} of your window left.
    </span>
  )
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}
