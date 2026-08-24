// The charts surface: monthly cash flow, where the money goes, subscriptions, and
// budget progress. All series come from lib/metrics, so a number here always matches
// Overview. ECharts renders to canvas, so colors are resolved from the tokens and the
// whole screen repaints on a theme change via useAppearanceKey.

import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { Sparkles } from 'lucide-react'
import { Button } from '@tracker-engine/ui'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Chart } from '@/components/Chart'
import { Money } from '@/components/Money'
import { EmptyState } from '@/components/EmptyState'
import * as metrics from '@/lib/metrics'
import { fmtAbs, fmtCompact } from '@/lib/format'
import { monthLabel } from '@/lib/dates'
import { UNCATEGORIZED_COLOR } from '@/domain/categories'
import { useAppearanceKey, useChartTokens, resolveColor } from '@/lib/useColorScheme'
import { useLedgerData } from '@/features/shared/useLedgerData'

export function InsightsScreen({ onOpenCoach }: { onOpenCoach: () => void }) {
  useAppearanceKey() // repaint canvas charts on theme/scheme change
  const t = useChartTokens()
  const { entries, categoryMap, budgets, currentMonth, currentEntries, loading } =
    useLedgerData()

  const cashflow = useMemo(() => metrics.monthlyCashflow(entries), [entries])
  const byCategory = useMemo(() => metrics.spendingByCategory(currentEntries), [currentEntries])
  const subscriptions = useMemo(() => metrics.detectRecurring(entries), [entries])
  const budgetRows = useMemo(
    () => metrics.budgetProgress(currentEntries, budgets),
    [currentEntries, budgets],
  )

  const cashflowOption = useMemo<EChartsOption>(
    () => ({
      grid: { left: 8, right: 8, top: 24, bottom: 24, containLabel: true },
      tooltip: { trigger: 'axis' },
      legend: { data: ['Income', 'Spend'], textStyle: { color: t.inkMuted }, top: 0 },
      xAxis: {
        type: 'category',
        data: cashflow.map((m) => monthLabel(m.month)),
        axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.inkMuted },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: t.inkMuted, formatter: (v: number) => fmtCompact(v) },
        splitLine: { lineStyle: { color: t.gridline } },
      },
      series: [
        {
          name: 'Income',
          type: 'bar',
          data: cashflow.map((m) => m.incomeMinor),
          itemStyle: { color: t.pos, borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Spend',
          type: 'bar',
          data: cashflow.map((m) => -m.spendMinor),
          itemStyle: { color: t.neg, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }),
    [cashflow, t],
  )

  const categoryOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'item', formatter: '{b}: {d}%' },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          avoidLabelOverlap: true,
          label: { show: false },
          data: byCategory.map((c) => {
            const cat = categoryMap.get(c.categoryId)
            return {
              name: cat?.name ?? 'Uncategorized',
              value: c.totalMinor,
              itemStyle: { color: resolveColor(cat?.color ?? UNCATEGORIZED_COLOR) },
            }
          }),
        },
      ],
    }),
    [byCategory, categoryMap],
  )

  if (loading) return null

  return (
    <div className="pb-6">
      <ScreenHeader
        title="Insights"
        subtitle={currentMonth ? monthLabel(currentMonth) : undefined}
        action={
          <Button size="sm" variant="secondary" onClick={onOpenCoach}>
            <Sparkles size={16} className="mr-1" /> Coach
          </Button>
        }
      />

      {entries.length === 0 ? (
        <div className="px-4">
          <EmptyState title="No data yet" hint="Sync or log transactions to see insights." />
        </div>
      ) : (
        <div className="space-y-6 px-4">
          <Panel title="Monthly cash flow">
            <Chart option={cashflowOption} ariaLabel="Income and spending by month" />
          </Panel>

          <Panel title="Where it goes">
            {byCategory.length === 0 ? (
              <EmptyState title="No spending this month" />
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-1/2">
                  <Chart option={categoryOption} ariaLabel="Spending by category" height={180} />
                </div>
                <ul className="flex-1 space-y-1.5">
                  {byCategory.slice(0, 6).map((c) => {
                    const cat = categoryMap.get(c.categoryId)
                    return (
                      <li key={c.categoryId} className="flex items-center gap-2 text-sm">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: cat?.color ?? UNCATEGORIZED_COLOR }}
                        />
                        <span className="flex-1 truncate text-ink-secondary">
                          {cat?.name ?? 'Uncategorized'}
                        </span>
                        <span className="tabular-nums text-ink">{fmtAbs(c.totalMinor)}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </Panel>

          {budgetRows.length > 0 && (
            <Panel title="Budgets">
              <div className="space-y-3">
                {budgetRows.map((b) => {
                  const cat = categoryMap.get(b.categoryId)
                  const over = b.ratio > 1
                  return (
                    <div key={b.categoryId}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-ink">{cat ? `${cat.icon} ${cat.name}` : b.categoryId}</span>
                        <span className={'tabular-nums ' + (over ? 'text-critical' : 'text-ink-secondary')}>
                          {fmtAbs(b.spentMinor)} / {fmtAbs(b.limitMinor)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-sunken">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.round(b.ratio * 100))}%`,
                            backgroundColor: over
                              ? 'var(--status-critical)'
                              : cat?.color ?? UNCATEGORIZED_COLOR,
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}

          <Panel title="Subscriptions">
            {subscriptions.length === 0 ? (
              <EmptyState title="No recurring charges detected" />
            ) : (
              <ul className="divide-y divide-line">
                {subscriptions.map((s) => (
                  <li key={s.merchant} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium text-ink">{s.merchant}</span>
                      <span className="ml-2 text-ink-muted">{s.cadence}</span>
                    </span>
                    <Money minor={s.avgAmountMinor} className="font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-muted">{title}</h2>
      {children}
    </section>
  )
}
