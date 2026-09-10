import { Card, ProgressRing } from '@tracker-engine/ui'
import { Moon, Utensils } from 'lucide-react'
import { grams } from '@/features/shared/format'
import { macroSharePct } from '@/lib/nutrition'
import { formatClock, formatDuration, windowProgress, windowState } from '@/lib/mealTiming'
import type { EatingWindow, LogEntry, MacroTargets, Nutrients } from '@/domain/types'
import { MACRO_BARS, MacroBar } from '@/features/shared/MacroBar'

/**
 * The day's budget: what's gone, what's left, and — only for people who keep an eating window —
 * whether they're ahead or behind for the time of day.
 *
 * Pacing is deliberately withheld otherwise. Without knowing when someone eats, "you're behind
 * on calories" at 3pm is a guess dressed as advice, and the app has no business nagging someone
 * who simply eats late.
 *
 * The whole card opens the day. It carries no "4 items today — tap to see them" hint any more: that
 * sentence existed to compensate for the food not being on the home screen at all, and the meal list
 * directly below it is the affordance the hint was standing in for.
 */
export function BudgetCard({
  totals,
  targets,
  left,
  window,
  entries,
  missing,
  onFix,
  onOpenDay,
}: {
  totals: Nutrients
  targets: MacroTargets | null
  left: MacroTargets | null
  window: EatingWindow | null
  entries: readonly LogEntry[]
  /** What the app still needs before it can set a first target. */
  missing: string[]
  onFix: () => void
  onOpenDay: () => void
}) {
  const shares = macroSharePct(totals)

  return (
    <Card className="p-0">
      <button
        onClick={onOpenDay}
        className="w-full rounded-2xl p-4 text-left active:bg-sunken"
      >
      <div className="flex items-center gap-4">
        <ProgressRing value={totals.kcal} max={targets?.kcal ?? 0} size={92}>
          <div className="text-center">
            <div className="tabular text-[20px] font-bold leading-none">{totals.kcal}</div>
            <div className="text-[10.5px] text-ink-muted">
              {targets ? `of ${targets.kcal}` : 'kcal'}
            </div>
          </div>
        </ProgressRing>

        <div className="flex-1 space-y-1.5">
          {MACRO_BARS.map((macro) => (
            <MacroBar
              key={macro.key}
              label={macro.label}
              eatenMg={totals[macro.key]}
              targetMg={targets?.[macro.key] ?? 0}
              sharePct={shares[macro.key]}
              color={macro.color}
            />
          ))}
        </div>
      </div>

      {left && targets ? (
        <p className="mt-3 text-[13px] text-ink-secondary">
          {left.kcal >= 0
            ? `${left.kcal} kcal and ${grams(Math.max(0, left.proteinMg))} protein left.`
            : `${Math.abs(left.kcal)} kcal over target.`}
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-[13px] text-ink-secondary">
            {missing.length > 0
              ? `No target yet — the first one needs your ${joinWords(missing)}.`
              : 'No target yet — pick a goal to get one.'}
          </p>
          <span
            role="button"
            onClick={(event) => {
              event.stopPropagation()
              onFix()
            }}
            className="mt-2 block w-full rounded-xl bg-sunken py-2.5 text-center text-[13.5px] font-semibold text-accent active:opacity-60"
          >
            {missing.length > 0 ? 'Fill that in' : 'Choose a goal'}
          </span>
        </div>
      )}
      </button>

      {window && (
        <WindowStrip window={window} targets={targets} totals={totals} entries={entries} />
      )}
    </Card>
  )
}

/**
 * The eating window, as a thing on the screen rather than a clause at the end of a sentence.
 *
 * The window was implemented and invisible: it appended half a line to the budget text, so someone
 * who turned it on reasonably concluded it did nothing. A bar showing where you are in the window,
 * with the fast or the time remaining named, is the entire point of having set one.
 */
function WindowStrip({
  window,
  targets,
  totals,
  entries,
}: {
  window: EatingWindow
  targets: MacroTargets | null
  totals: Nutrients
  entries: readonly LogEntry[]
}) {
  const state = windowState(window, entries)
  const progress = windowProgress(window)
  const isOpen = state.phase === 'open'

  return (
    <div className="border-t border-line px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
          {isOpen ? (
            <Utensils size={13} className="text-accent" />
          ) : (
            <Moon size={13} className="text-ink-muted" />
          )}
          {formatClock(window.startMinute)}–{formatClock(window.endMinute)}
        </span>
        <span className="tabular text-[12px] text-ink-muted">
          {state.phase === 'before'
            ? `Opens in ${formatDuration(state.opensInMinutes ?? 0)}`
            : state.phase === 'after'
              ? 'Closed for today'
              : `${formatDuration(state.closesInMinutes ?? 0)} left`}
        </span>
      </div>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.round(progress * 100)}%`,
            background: isOpen ? 'var(--accent)' : 'var(--text-muted)',
          }}
        />
      </div>

      <p className="tabular mt-1.5 text-[12px] text-ink-muted">
        {state.fastedMinutes !== null && `Fasted ${formatDuration(state.fastedMinutes)}`}
        {state.fastedMinutes !== null && targets && isOpen && ' · '}
        {targets && isOpen && pacing(window, targets, totals)}
      </p>
    </div>
  )
}

/**
 * Whether the day is ahead or behind for the time of day.
 *
 * Only inside the window, and only with a target — pacing someone against a figure the app guessed
 * would be nagging them with arithmetic it doesn't believe.
 */
function pacing(window: EatingWindow, targets: MacroTargets, totals: Nutrients): string {
  const expected = Math.round(targets.kcal * windowProgress(window))
  const drift = totals.kcal - expected
  if (Math.abs(drift) < 150) return 'on pace for the time of day'
  return drift < 0 ? `${Math.abs(drift)} kcal behind pace` : `${drift} kcal ahead of pace`
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}
