import { Card } from '@tracker-engine/ui'
import { convertWeight } from '@tracker-engine/core'
import { grams } from '@/features/shared/format'
import { useUnits } from '@/features/shared/useUnits'
import type { InsightsData } from './useInsightsData'

/** The window in five numbers, so the charts below have something to be read against. */
export function SummaryCard({ data, rangeLabel }: { data: InsightsData; rangeLabel: string }) {
  const units = useUnits()
  const averageKcal =
    data.days.length === 0
      ? 0
      : Math.round(data.days.reduce((sum, day) => sum + day.kcal, 0) / data.days.length)

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">{rangeLabel}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <Stat label="Days logged">{data.loggedDayCount}</Stat>
        <Stat label="Average intake">{averageKcal} kcal</Stat>
        <Stat label="Average protein">{grams(data.averages.proteinMg)}</Stat>
        <Stat label="Within 10% of target">
          {data.adherencePct === null ? '—' : `${Math.round(data.adherencePct)}% of days`}
        </Stat>
        <Stat label="Weight change">
          {data.weightChangeKg === null
            ? '—'
            : `${data.weightChangeKg >= 0 ? '+' : ''}${convertWeight(data.weightChangeKg, units.weight).toFixed(1)} ${units.weight}`}
        </Stat>
        <Stat label="Expenditure">
          {data.expenditureKcal === null
            ? 'not measured yet'
            : `${data.expenditureKcal} ± ${data.expenditureSe}`}
        </Stat>
      </dl>
    </Card>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="tabular text-[15px] font-semibold">{children}</dd>
    </div>
  )
}
