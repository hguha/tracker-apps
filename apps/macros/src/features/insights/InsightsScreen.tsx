import { useState } from 'react'
import { Card, PillSelect } from '@tracker-engine/ui'
import { bmi, goalWeightKg } from '@/lib/micronutrients'
import { kcalPerKg } from '@/lib/expenditure'
import { IntakeChart } from './IntakeChart'
import { WeightChart } from './WeightChart'
import { MacroSplitChart } from './MacroSplitChart'
import { CheckInHistory } from './CheckInHistory'
import { AdherenceChart, ProteinChart, WeekdayChart } from './chartsIntake'
import { BalanceChart, ExpenditureChart } from './chartsBody'
import { ConsistencyChart, MealTimingChart } from './chartsHabits'
import { AdequacyChart } from './chartsNutrients'
import { useInsightsData } from './useInsightsData'

const RANGES = [
  { value: '30', label: '30d' },
  { value: '56', label: '8w' },
  { value: '90', label: '90d' },
  { value: '365', label: '1y' },
]

export function InsightsScreen() {
  const [range, setRange] = useState('56')
  const data = useInsightsData(Number(range))

  const latest = data.trend[data.trend.length - 1]
  const energyPerKg = kcalPerKg(
    data.program?.goal ?? 'maintain',
    data.program?.ratePctPerWeek ?? 0,
  )

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h1 className="text-[17px] font-semibold tracking-tight">Insights</h1>
        <div className="shrink-0">
          <PillSelect
            value={range}
            options={RANGES}
            onChange={(next) => setRange(next ?? '56')}
          />
        </div>
      </div>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Expenditure</h2>
        {data.expenditureKcal !== null ? (
          <>
            <p className="tabular mt-1 text-[26px] font-bold leading-tight">
              {data.expenditureKcal}
              <span className="text-[14px] font-medium text-ink-muted">
                {' '}
                ± {data.expenditureSe} kcal/day
              </span>
            </p>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              Measured from {data.windows.length} week{data.windows.length === 1 ? '' : 's'} of
              weigh-ins and logs — not a formula, and not a wearable estimate.
            </p>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-muted">
            Needs a week with at least four days logged and three weigh-ins.
          </p>
        )}
        {latest && (
          <p className="tabular mt-2 border-t border-line pt-2 text-[12.5px] text-ink-muted">
            Trend {latest.trendKg.toFixed(1)} kg
            {data.ratePerWeek !== null &&
              ` · ${data.ratePerWeek >= 0 ? '+' : ''}${data.ratePerWeek.toFixed(2)} kg/week`}
            {data.profile?.heightCm && ` · BMI ${bmi(latest.trendKg, data.profile.heightCm).toFixed(1)}`}
            {data.program &&
              data.program.ratePctPerWeek !== 0 &&
              ` · ${goalWeightKg(latest.trendKg, data.program.ratePctPerWeek)?.toFixed(1)} kg in 12 weeks at this pace`}
          </p>
        )}
      </Card>

      <IntakeChart days={data.days} />
      <ProteinChart days={data.days} />
      <AdherenceChart days={data.days} />
      <WeightChart trend={data.trend} />
      <ExpenditureChart windows={data.windows} />
      <BalanceChart
        days={data.days}
        trend={data.trend}
        expenditureKcal={data.expenditureKcal}
        energyPerKg={energyPerKg}
      />
      <MacroSplitChart days={data.days} />
      <AdequacyChart averages={data.averages} dayCount={data.loggedDayCount} />
      <MealTimingChart kcalByHour={data.kcalByHour} window={data.profile?.eatingWindow ?? null} />
      <ConsistencyChart days={data.days} />
      <WeekdayChart days={data.days} />
      <CheckInHistory />
    </div>
  )
}
