import { useLiveQuery } from 'dexie-react-hooks'
import { trendChangePerWeek, weightTrend } from '@tracker-engine/body'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { bmi, goalWeightKg } from '@/lib/micronutrients'

const GOAL_VERB: Record<string, string> = {
  lose: 'Losing',
  gain: 'Building',
  maintain: 'Holding',
}

/**
 * Where the weight is going, on the screen the user opens most.
 *
 * Shows the projection alongside the measured rate, so the goal is checkable rather than
 * aspirational: if the trend says +0.1 kg/week on a losing program, that contradiction should be
 * visible here and not buried in Insights.
 */
export function GoalCard() {
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const weights = useLiveQuery(() => repo.weights(), [], [])
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  const trend = weightTrend(weights ?? [])
  const latest = trend[trend.length - 1]
  if (!program || !latest) return null

  const rate = trendChangePerWeek(trend)
  const projected = goalWeightKg(latest.trendKg, program.ratePctPerWeek)
  const height = profile?.heightCm ?? null
  const targetPerWeek = (program.ratePctPerWeek / 100) * latest.trendKg

  // On track when moving the right way at a plausible fraction of the intended rate.
  const onTrack =
    rate === null || program.goal === 'maintain'
      ? null
      : Math.sign(rate) === Math.sign(targetPerWeek) && Math.abs(rate) >= Math.abs(targetPerWeek) * 0.4

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">
          {GOAL_VERB[program.goal] ?? 'Goal'}
        </h2>
        {onTrack !== null && (
          <span
            className="text-[12px] font-semibold"
            style={{ color: onTrack ? 'var(--target-on)' : 'var(--confidence-medium)' }}
          >
            {onTrack ? 'on track' : 'off pace'}
          </span>
        )}
      </div>

      <p className="tabular mt-1 text-[22px] font-bold leading-tight">
        {latest.trendKg.toFixed(1)}
        <span className="text-[13px] font-medium text-ink-muted"> kg now</span>
        {projected !== null && (
          <>
            <span className="text-[13px] font-medium text-ink-muted"> → </span>
            {projected.toFixed(1)}
            <span className="text-[13px] font-medium text-ink-muted"> in 12 weeks</span>
          </>
        )}
      </p>

      <p className="tabular mt-1 text-[12.5px] text-ink-muted">
        {rate === null
          ? 'Weigh in a few more times to measure your rate.'
          : `${rate >= 0 ? '+' : ''}${rate.toFixed(2)} kg/week measured` +
            (program.goal === 'maintain'
              ? ''
              : ` · aiming for ${targetPerWeek >= 0 ? '+' : ''}${targetPerWeek.toFixed(2)}`)}
        {height !== null && ` · BMI ${bmi(latest.trendKg, height).toFixed(1)}`}
      </p>
    </Card>
  )
}
