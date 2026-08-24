import { distanceFromM, formatDuration } from '@/lib/units'
import { ChartCard } from './ChartCard'
import { type InsightsData } from './useInsightsData'

/**
 * Cardio time and distance as **two separate charts**, never two y-axes — the
 * alignment of two scales on one plot invents a correlation that isn't there.
 */

export function CardioChart({ data }: { data: InsightsData }) {
  const unit = data.profile.unitDistance
  const hasCardio = data.cardioSeconds > 0 || data.cardioMeters > 0

  const totalDistance = distanceFromM(data.cardioMeters, unit)

  return (
    <ChartCard
      title="Cardio"
      subtitle="Kept separate from lifting volume"
      isEmpty={!hasCardio}
      emptyMessage="Log a run, ride, or row to see cardio totals."
      table={{
        columns: ['Measure', 'Total'],
        rows: [
          ['Time', formatDuration(data.cardioSeconds)],
          ['Distance', `${totalDistance.toFixed(2)} ${unit}`],
        ],
      }}
    >
      <div className="grid grid-cols-2 gap-2 px-2 py-3">
        <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
            Total time
          </p>
          <p className="mt-0.5 text-[21px] font-bold leading-tight">
            {formatDuration(data.cardioSeconds)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-sunken px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
            Total distance
          </p>
          <p className="mt-0.5 text-[21px] font-bold leading-tight">
            {totalDistance.toFixed(1)}
            <span className="ml-1 text-[13px] font-semibold text-ink-muted">{unit}</span>
          </p>
        </div>
      </div>
    </ChartCard>
  )
}

// D-37
