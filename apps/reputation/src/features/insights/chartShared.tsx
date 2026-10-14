import { formatShortDay } from '@tracker-engine/core'
import { chartChrome } from '@tracker-engine/ui/charts'
import { resolveRegionColor } from '@/lib/palette'
import { type ExerciseSeries, type InsightsData } from './useInsightsData'
import { TrendingUp } from 'lucide-react'

export const chrome = () => ({ ...chartChrome(), plot: resolveRegionColor('chest') })

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function weekLabels(weeks: string[]): string[] {
  return weeks.map(formatShortDay)
}

export function findSeries(
  data: InsightsData,
  exerciseId: string | null,
): ExerciseSeries | undefined {
  return exerciseId ? data.exerciseSeries.find((s) => s.exerciseId === exerciseId) : undefined
}

export function PickExerciseCard({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="px-4 pt-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="text-[12.5px] text-ink-muted">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3 px-4 py-6">
        <TrendingUp size={22} className="shrink-0 text-ink-muted" />
        <p className="text-[13.5px] text-ink-secondary">
          This chart shows one lift at a time. Pick{' '}
          <span className="font-semibold text-ink">exactly one</span> exercise in the
          Exercise filter above.
        </p>
      </div>
    </div>
  )
}

// B-9

export const SET_COUNT_BUCKETS = ['1-5', '6-10', '11-15', '16-20', '21-25', '26+']

export const GAP_BUCKETS = ['0-1', '2', '3', '4-6', '7+']

export function gapTally(gaps: number[]): number[] {
  const tally = new Array<number>(GAP_BUCKETS.length).fill(0)
  for (const g of gaps) {
    const i = g <= 1 ? 0 : g === 2 ? 1 : g === 3 ? 2 : g <= 6 ? 3 : 4
    tally[i]! += 1
  }
  return tally
}

export function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[19px] font-bold leading-tight">{value}</p>
      <p className="text-[11.5px] text-ink-muted">{label}</p>
    </div>
  )
}

export function formatHour(hour: number): string {
  const period = hour < 12 ? 'a' : 'p'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${period}`
}

// Trailing moving average (last `window` points, inclusive) — shared by the volume
// and duration trend lines. The slice is never empty, so no divide-by-zero.
export function movingAverage(values: number[], window = 4): number[] {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - (window - 1)), index + 1)
    return Math.round(slice.reduce((sum, v) => sum + v, 0) / slice.length)
  })
}
