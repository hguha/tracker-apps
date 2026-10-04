import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { bodyWeightFromKg, cn, convertWeight, signed } from '@tracker-engine/core'
import { trendChangePerWeek, weightTrend } from '@tracker-engine/body'
import { Card } from '@tracker-engine/ui'
import { ChevronDown, Flag, PartyPopper, Target } from 'lucide-react'
import * as repo from '@/data/repository'
import { goalProgress, type GoalForecast } from '@/lib/goal'
import { useUnits } from '@/features/shared/useUnits'
import { paceLabel } from '@/features/shared/pace'
import { arrivalDay, arrivalRange, perWeek, timeUntil } from '@/features/shared/goalText'
import type { WeightUnit } from '@tracker-engine/core'
import type { Program } from '@/domain/types'

const GOAL_VERB: Record<string, string> = {
  lose: 'Losing',
  gain: 'Building',
  maintain: 'Holding',
}

export function GoalCard({ onOpenTargets }: { onOpenTargets: () => void }) {
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const weights = useLiveQuery(() => repo.weights(), [], [])
  const forecast = useLiveQuery(() => repo.goalOutlook(), [], null)
  const units = useUnits()
  const [isOpen, setIsOpen] = useState(false)

  const trend = weightTrend(weights ?? [])
  const latest = trend[trend.length - 1]
  if (!program || !latest) return null

  const show = (kg: number) => bodyWeightFromKg(kg, units.weight)

  if (program.targetKg === null) {
    const rate = trendChangePerWeek(trend)
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
            : `${signed(convertWeight(rate, units.weight), 2)} ${units.weight}/week measured`}
        </p>
        {program.goal !== 'maintain' && (
          <button
            onClick={onOpenTargets}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-[13.5px] font-semibold text-accent-contrast active:brightness-90"
          >
            <Target size={15} />
            Set a goal weight
          </button>
        )}
      </Card>
    )
  }

  const progress = goalProgress({
    goal: program.goal,
    targetKg: program.targetKg,
    startKg: program.startKg,
    trendKg: latest.trendKg,
  })

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
  const needsAttention = forecast !== null && forecast !== undefined && forecast.pace !== 'matches'

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

      <button
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="mt-2 flex w-full items-center gap-1.5 text-left active:opacity-60"
      >
        <span className="min-w-0 flex-1 text-[13px]">
          <Headline
            forecast={forecast ?? null}
            program={program}
            isReached={progress.isReached}
          />
        </span>
        {needsAttention && (
          <span
            aria-label="Target doesn't match your pace"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: 'var(--confidence-medium)' }}
          />
        )}
        <ChevronDown
          size={15}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="mt-2.5 space-y-2.5 border-t border-line pt-3">
          {forecast ? (
            <ForecastDetail forecast={forecast} program={program} unit={units.weight} />
          ) : (
            <p className="text-[12.5px] text-ink-muted">
              Weigh in and log a few days to get a forecast.
            </p>
          )}
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

function Headline({
  forecast,
  program,
  isReached,
}: {
  forecast: GoalForecast | null
  program: Program
  isReached: boolean
}) {
  if (isReached) return <span className="text-ink-secondary">At your goal. Nice work.</span>
  if (forecast?.isWrongWay) {
    return (
      <span style={{ color: 'var(--confidence-medium)' }}>Trending away from your goal</span>
    )
  }
  const likelyAt = forecast?.likely?.etaAt ?? null
  if (likelyAt !== null) {
    return (
      <span className="flex items-center gap-1.5">
        <Flag size={14} className="shrink-0 text-accent" />
        <span className="font-semibold">Likely {arrivalDay(likelyAt)}</span>
        <span className="tabular text-ink-muted">· {timeUntil(likelyAt)}</span>
      </span>
    )
  }
  const onTargetAt = forecast?.onTarget?.etaAt ?? null
  if (onTargetAt !== null) {
    return (
      <span className="text-ink-secondary">
        On target: {arrivalDay(onTargetAt)}
        <span className="text-ink-muted"> · {timeUntil(onTargetAt)}</span>
      </span>
    )
  }
  const chosenAt = forecast?.chosen.etaAt ?? null
  const pace = paceLabel(program.goal, program.ratePctPerWeek)
  if (chosenAt !== null) {
    return (
      <span className="text-ink-muted">
        {pace ? `${pace} pace` : 'Your pace'} gets you there {arrivalDay(chosenAt)}
      </span>
    )
  }
  return <span className="text-ink-muted">Weigh in a few times to get a date</span>
}

function ForecastDetail({
  forecast,
  program,
  unit,
}: {
  forecast: GoalForecast
  program: Program
  unit: WeightUnit
}) {
  const { likely, onTarget, eating, scale } = forecast
  const pace = paceLabel(program.goal, program.ratePctPerWeek) ?? 'chosen'

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Lane
          title="Your recent pace"
          at={likely?.etaAt ?? null}
          rate={likely ? perWeek(likely.kgPerWeek, unit) : null}
          note={
            likely
              ? arrivalRange(likely.earliestAt, likely.latestAt)
              : 'Needs a few days of logs'
          }
          isPrimary
        />
        <Lane
          title="If you hit your target"
          at={onTarget?.etaAt ?? null}
          rate={onTarget ? perWeek(onTarget.kgPerWeek, unit) : null}
          note={onTarget ? `${onTarget.targetKcal.toLocaleString()} kcal/day` : 'No calorie target yet'}
        />
      </div>

      {eating && onTarget && <IntakeBar mean={eating.meanIntakeKcal} target={onTarget.targetKcal} days={eating.days} />}

      {(eating || scale) && (
        <p className="tabular text-[12px] text-ink-muted">
          {[
            eating && `Food log ${perWeek(eating.kgPerWeek, unit)}`,
            scale && `Scale ${perWeek(scale.kgPerWeek, unit)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      <PaceNotice forecast={forecast} program={program} pace={pace} unit={unit} />
    </>
  )
}

function Lane({
  title,
  at,
  rate,
  note,
  isPrimary = false,
}: {
  title: string
  at: number | null
  rate: string | null
  note: string | null
  isPrimary?: boolean
}) {
  return (
    <div className={cn('rounded-xl px-3 py-2', isPrimary ? 'bg-accent-wash' : 'bg-sunken')}>
      <p className="text-[11.5px] font-medium text-ink-muted">{title}</p>
      <p className={cn('tabular text-[16px] font-bold leading-tight', isPrimary && 'text-accent')}>
        {at === null ? '—' : arrivalDay(at)}
      </p>
      <p className="tabular text-[11.5px] text-ink-secondary">
        {[rate, at !== null && timeUntil(at)].filter(Boolean).join(' · ') || ' '}
      </p>
      {note && <p className="tabular truncate text-[11px] text-ink-muted">{note}</p>}
    </div>
  )
}

function IntakeBar({ mean, target, days }: { mean: number; target: number; days: number }) {
  const gap = mean - target
  const isClose = Math.abs(gap) <= target * 0.05
  const scaleMax = Math.max(mean, target) * 1.1
  const color = isClose ? 'var(--target-on)' : gap > 0 ? 'var(--target-over)' : 'var(--accent)'

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-ink-muted">
          Eating · last {days} logged day{days === 1 ? '' : 's'}
        </span>
        <span className="tabular font-semibold" style={{ color }}>
          {isClose ? 'On target' : `${Math.abs(gap).toLocaleString()} ${gap > 0 ? 'over' : 'under'}`}
        </span>
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-sunken">
        <div
          className="h-full rounded-full"
          style={{ width: `${(mean / scaleMax) * 100}%`, background: color }}
        />
        <div
          className="absolute -top-0.5 h-3 w-0.5 rounded-full bg-ink"
          style={{ left: `${(target / scaleMax) * 100}%` }}
        />
      </div>
      <p className="tabular mt-0.5 text-[11.5px] text-ink-muted">
        {mean.toLocaleString()} avg · target {target.toLocaleString()} kcal
      </p>
    </div>
  )
}

function PaceNotice({
  forecast,
  program,
  pace,
  unit,
}: {
  forecast: GoalForecast
  program: Program
  pace: string
  unit: WeightUnit
}) {
  if (forecast.pace === 'matches') return null
  const isCustom = forecast.pace === 'custom'
  const text = isCustom
    ? `Custom calories are on, so your ${pace} pace isn't setting your target.`
    : `Your target is set for ${forecast.onTarget ? perWeek(forecast.onTarget.kgPerWeek, unit) : 'a different pace'}, not your ${pace} pace (${perWeek(forecast.chosen.kgPerWeek, unit)}).`

  return (
    <div
      className="rounded-xl border px-3 py-2 text-[12.5px]"
      style={{ borderColor: 'var(--confidence-medium)' }}
    >
      <p>{text}</p>
      <button
        onClick={() =>
          void (isCustom ? repo.setManualTargets(null) : repo.alignTargetsToPace(program.id))
        }
        className="mt-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-contrast active:brightness-90"
      >
        Use my {pace} pace
      </button>
    </div>
  )
}

function Header({ goal }: { goal: string }) {
  return (
    <h2 className="text-[15px] font-semibold tracking-tight">{GOAL_VERB[goal] ?? 'Goal'}</h2>
  )
}
