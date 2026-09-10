import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DAY_MS, bodyWeightFromKg, convertWeight, formatRelativeDay } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend } from '@tracker-engine/body'
import { Card } from '@tracker-engine/ui'
import { ChevronDown, PartyPopper, Target } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { goalProgress } from '@/lib/goal'
import { useUnits } from '@/features/shared/useUnits'

const GOAL_VERB: Record<string, string> = {
  lose: 'Losing',
  gain: 'Building',
  maintain: 'Holding',
}

/**
 * Where the weight is going, and when it gets there.
 *
 * The version this replaces showed the rate and a twelve-week projection, which is checkable but has
 * no end: nothing ever satisfied "losing 0.5% a week", so logging the weight you were aiming for did
 * nothing at all. With a target it has a bar, a date, and a state for having arrived.
 *
 * The date comes from the **measured** rate, never the intended one. An ETA off the plan says what
 * would happen if the plan were working; an ETA off the trend says what is happening. Where they
 * disagree, that disagreement is the useful part, so both appear.
 */
export function GoalCard({ onOpenTargets }: { onOpenTargets: () => void }) {
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const weights = useLiveQuery(() => repo.weights(), [], [])
  const units = useUnits()
  const [isOpen, setIsOpen] = useState(false)

  const trend = weightTrend(weights ?? [])
  const latest = trend[trend.length - 1]
  if (!program || !latest) return null

  const rate = trendChangePerWeek(trend)
  const targetPerWeek = (program.ratePctPerWeek / 100) * latest.trendKg
  const show = (kg: number) => bodyWeightFromKg(kg, units.weight)

  // No target set: say what one would buy you, and offer it. The missing half of the feature.
  if (program.targetKg === null) {
    return (
      <Card className="p-4">
        <Header goal={program.goal} />
        <p className="tabular mt-1 text-[22px] font-bold leading-tight">
          {show(latest.trendKg)}
          <span className="text-[13px] font-medium text-ink-muted"> {units.weight} now</span>
        </p>
        <p className="tabular mt-1 text-[12.5px] text-ink-muted">
          {rate === null
            ? 'Weigh in a few more times to measure your rate.'
            : `${signed(convertWeight(rate, units.weight))} ${units.weight}/week measured`}
        </p>
        {program.goal !== 'maintain' && (
          <>
            <p className="mt-2 text-[12.5px] text-ink-secondary">
              Without one there&rsquo;s nothing to arrive at: &ldquo;
              {program.ratePctPerWeek < 0 ? 'lose' : 'gain'}{' '}
              {Math.abs(program.ratePctPerWeek)}% a week&rdquo; is never finished. A goal weight adds
              a progress bar and a date worked out from your own measured rate.
            </p>
            <button
              onClick={onOpenTargets}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-[13.5px] font-semibold text-accent-contrast active:brightness-90"
            >
              <Target size={15} />
              Set a goal weight
            </button>
          </>
        )}
      </Card>
    )
  }

  const progress = goalProgress({
    goal: program.goal,
    targetKg: program.targetKg,
    startKg: program.startKg,
    trendKg: latest.trendKg,
    ratePerWeek: rate,
    ratePctPerWeek: program.ratePctPerWeek,
  })

  // Reached, and not yet acknowledged: the one moment this whole feature exists for.
  if (progress.isReached && program.reachedAt === null) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <PartyPopper size={18} className="shrink-0 text-accent" />
          <h2 className="text-[15px] font-semibold tracking-tight">
            You hit {show(program.targetKg)} {units.weight}
          </h2>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Your trend is {show(latest.trendKg)} {units.weight}
          {program.startKg !== null &&
            `, from ${show(program.startKg)} when you set it — ${Math.abs(
              Math.round(convertWeight(program.startKg - latest.trendKg, units.weight) * 10) / 10,
            )} ${units.weight}`}
          .
        </p>
        <p className="mt-2 text-[12.5px] text-ink-secondary">
          Holding here means eating at your measured expenditure rather than under it. The check-in
          will find that number for you — switching to maintain is the whole change.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={onOpenTargets}
            className="min-w-0 flex-1 rounded-xl bg-accent py-2.5 text-[13.5px] font-semibold text-accent-contrast active:brightness-90"
          >
            Choose what&rsquo;s next
          </button>
          <button
            onClick={() => void repo.markGoalReached(program.id)}
            className="shrink-0 rounded-xl border border-line px-3 py-2.5 text-[13.5px] font-semibold text-ink-secondary active:bg-sunken"
          >
            Later
          </button>
        </div>
      </Card>
    )
  }

  const remaining = Math.abs(convertWeight(progress.remainingKg, units.weight))
  const weeklyTarget = convertWeight(targetPerWeek, units.weight)

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <Header goal={program.goal} />
        <button
          onClick={onOpenTargets}
          className="shrink-0 text-[12px] font-semibold text-accent active:opacity-60"
        >
          {show(program.targetKg)} {units.weight} goal
        </button>
      </div>

      <p className="tabular mt-1 text-[22px] font-bold leading-tight">
        {show(latest.trendKg)}
        <span className="text-[13px] font-medium text-ink-muted">
          {' '}
          {units.weight} · {remaining.toFixed(1)} to go
        </span>
      </p>

      {progress.fraction !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.round(progress.fraction * 100)}%` }}
          />
        </div>
      )}

      {/*
        One line, not three. The card used to print the measured rate, the intended rate, the ETA, the
        plan's ETA and a BMI — five figures for a question with one answer, "am I on track and when do
        I arrive". The rest is a tap away, which is where the comparisons belong.
      */}
      <button
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="mt-2 flex w-full items-baseline gap-1.5 text-left active:opacity-60"
      >
        <span className="min-w-0 flex-1 text-[13px]">
        {progress.isWrongWay ? (
          <span style={{ color: 'var(--confidence-medium)' }}>
            The trend is moving away from your goal. Worth a look at the target rather than the week.
          </span>
        ) : progress.etaAt !== null ? (
          <span className="text-ink-secondary">
            At this rate: {formatRelativeDay(progress.etaAt)}
            {progress.plannedEtaAt !== null &&
              // Only when they meaningfully disagree; a fortnight is inside the noise of either.
              Math.abs(progress.plannedEtaAt - progress.etaAt) > 14 * DAY_MS &&
              ` — the plan said ${formatRelativeDay(progress.plannedEtaAt)}`}
          </span>
        ) : (
          <span className="text-ink-muted">
            {progress.plannedEtaAt === null
              ? 'No date yet — the trend needs to move first.'
              : `Flat so far. The plan puts it at ${formatRelativeDay(progress.plannedEtaAt)}.`}
          </span>
        )}
        </span>
        <ChevronDown
          size={15}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="mt-2 space-y-2 border-t border-line pt-2.5 text-[12.5px] text-ink-secondary">
          <Row
            label="Started at"
            value={
              program.startKg === null
                ? 'not recorded'
                : `${show(program.startKg)} ${units.weight}`
            }
          />
          <Row label="Now" value={`${show(latest.trendKg)} ${units.weight} (trend)`} />
          <Row label="Goal" value={`${show(program.targetKg)} ${units.weight}`} />
          <Row
            label="Aiming for"
            value={`${signed(weeklyTarget)} ${units.weight}/week`}
          />
          <Row
            label="Actually doing"
            value={
              rate === null
                ? 'not enough weigh-ins'
                : `${signed(convertWeight(rate, units.weight))} ${units.weight}/week`
            }
          />
          <p className="pt-1 text-[12px] text-ink-muted">
            The date comes from what you are actually doing, not from the plan — a projection off the
            intended rate only tells you what would happen if the plan were working. Weigh in most
            mornings and it sharpens; the weekly check-in adjusts your calories to close any gap.
          </p>
          <button
            onClick={onOpenTargets}
            className="w-full rounded-xl bg-sunken py-2 text-[13px] font-semibold text-accent active:opacity-60"
          >
            Change the goal or the pace
          </button>
        </div>
      )}
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className="tabular text-right">{value}</span>
    </p>
  )
}

function Header({ goal }: { goal: string }) {
  return (
    <h2 className="text-[15px] font-semibold tracking-tight">{GOAL_VERB[goal] ?? 'Goal'}</h2>
  )
}

/** A rate reads as a rate only with its sign: "+0.24", "-0.55". */
const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
