import { useState } from 'react'
import {
  FilterChipButton,
  FilterSheet,
  SegmentedTabs,
  type SegmentedTab,
} from '@tracker-engine/ui'
import { TrendingUp } from 'lucide-react'
import { kcalPerKg } from '@/lib/expenditure'
import { IntakeChart } from './IntakeChart'
import { WeightChart } from './WeightChart'
import { MacroSplitChart } from './MacroSplitChart'
import { CheckInHistory } from './CheckInHistory'
import { SummaryCard } from './SummaryCard'
import { AdherenceChart, ProteinChart, TopFoodsChart, WeekdayChart } from './chartsIntake'
import { BalanceChart, ExpenditureChart } from './chartsBody'
import { ConsistencyChart, MealTimingChart, SourceMixChart } from './chartsHabits'
import { AdequacyChart, FiberChart } from './chartsNutrients'
import { useInsightsData } from './useInsightsData'

const RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '8w', label: '8 weeks', days: 56 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '6m', label: '6 months', days: 182 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: 3650 },
] as const

type RangeKey = (typeof RANGES)[number]['key']
type TabKey = 'overview' | 'intake' | 'body' | 'habits' | 'nutrients'

const TABS: SegmentedTab<TabKey>[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'intake', label: 'Intake' },
  { key: 'body', label: 'Body' },
  { key: 'habits', label: 'Habits' },
  { key: 'nutrients', label: 'Nutrients' },
]

/**
 * Insights, in REPutation's shape: sub-tabs for the question you're asking, one range filter
 * across all of them.
 *
 * Fourteen charts on one scroll is a list nobody reads to the bottom of, and the range control
 * has to be reachable without scrolling past six charts to find it.
 */
export function InsightsScreen() {
  const [tab, setTab] = useState<TabKey>('overview')
  const [rangeKey, setRangeKey] = useState<RangeKey>('8w')
  const [isRangeOpen, setIsRangeOpen] = useState(false)

  const range = RANGES.find((option) => option.key === rangeKey)!
  const data = useInsightsData(range.days)
  const energyPerKg = kcalPerKg(
    data.program?.goal ?? 'maintain',
    data.program?.ratePctPerWeek ?? 0,
  )

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-surface px-2 py-1.5">
        <SegmentedTabs tabs={TABS} active={tab} onSelect={setTab} variant="underline" />
      </div>

      <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 py-2">
        <FilterChipButton label={range.label} isActive onClick={() => setIsRangeOpen(true)} />
        <span className="tabular self-center text-[12.5px] text-ink-muted">
          {data.loggedDayCount} day{data.loggedDayCount === 1 ? '' : 's'} logged
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 pb-8">
        {data.loggedDayCount === 0 ? (
          <div className="mt-20 px-6 text-center">
            <TrendingUp size={28} className="mx-auto text-ink-muted" />
            <p className="mt-3 text-[16px] font-semibold">Nothing to chart yet</p>
            <p className="mt-1 text-[14px] text-ink-muted">
              Log a few days and weigh in, and the trends show up here.
            </p>
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <>
                <SummaryCard data={data} rangeLabel={range.label} />
                <IntakeChart days={data.days} />
                <WeightChart trend={data.trend} />
                <ExpenditureChart windows={data.windows} />
              </>
            )}

            {tab === 'intake' && (
              <>
                <IntakeChart days={data.days} />
                <ProteinChart days={data.days} />
                <MacroSplitChart days={data.days} />
                <AdherenceChart days={data.days} />
                <TopFoodsChart topFoods={data.topFoods} />
                <WeekdayChart days={data.days} />
              </>
            )}

            {tab === 'body' && (
              <>
                <WeightChart trend={data.trend} />
                <ExpenditureChart windows={data.windows} />
                <BalanceChart
                  days={data.days}
                  trend={data.trend}
                  expenditureKcal={data.expenditureKcal}
                  energyPerKg={energyPerKg}
                />
                <CheckInHistory />
              </>
            )}

            {tab === 'habits' && (
              <>
                <MealTimingChart
                  kcalByHour={data.kcalByHour}
                  window={data.profile?.eatingWindow ?? null}
                />
                <ConsistencyChart days={data.days} />
                <SourceMixChart sourceCounts={data.sourceCounts} />
              </>
            )}

            {tab === 'nutrients' && (
              <>
                <AdequacyChart averages={data.averages} dayCount={data.loggedDayCount} />
                <FiberChart days={data.days} />
              </>
            )}
          </>
        )}
      </div>

      {isRangeOpen && (
        <FilterSheet
          title="Date range"
          singleSelect
          options={RANGES.map((option) => ({ value: option.key, label: option.label }))}
          selected={[rangeKey]}
          onChange={(selected) => {
            if (selected[0]) setRangeKey(selected[0] as RangeKey)
          }}
          onDismiss={() => setIsRangeOpen(false)}
        />
      )}
    </div>
  )
}
