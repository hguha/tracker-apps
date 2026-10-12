import { plural, signed } from '@tracker-engine/core'
import { ChartCard } from '@tracker-engine/ui/charts'
import { Card } from '@tracker-engine/ui'
import { CUISINE_LABELS } from '@/lib/cuisine'
import { venueLabel } from '@/features/shared/venue'
import { RankedBars } from './RankedBars'
import type { CuisineShare, VenueSummary } from '@/lib/patterns'

/** Below this share of occasions recorded, the split is a sample rather than a pattern. */
const THIN = 40

/**
 * Home versus out, and what the difference costs.
 *
 * The bars are occasions and the caption is the cost, because the split on its own tells nobody
 * anything they didn't know. "Days with a meal out ran 380 kcal over; days at home ran 40 under"
 * is a finding — and it's the reason this field is worth tapping.
 */
export function VenueSplitChart({ venues }: { venues: VenueSummary }) {
  const recorded = venues.breakdown.filter((row) => row.venue !== null)
  const total = recorded.reduce((sum, row) => sum + row.occasions, 0)

  return (
    <ChartCard
      title="Where you eat"
      subtitle={subtitle(venues, total)}
      isEmpty={total === 0}
      emptyMessage="Tap home, out or takeaway on a meal in Today and this fills in."
      table={{
        columns: ['Where', 'Occasions', 'Mean kcal'],
        rows: recorded.map((row) => [venueLabel(row.venue), row.occasions, row.meanKcal]),
      }}
    >
      <RankedBars
        labels={recorded.map((row) => venueLabel(row.venue))}
        values={recorded.map((row) => row.occasions)}
        name="Occasions"
        gridLeft={78}
        gridRight={44}
        barMaxWidth={16}
        barLabel={(index) => `${recorded[index]?.meanKcal ?? 0} kcal avg`}
        ariaLabel="Eating occasions by where they happened"
      />
    </ChartCard>
  )
}

function subtitle(venues: VenueSummary, total: number): string | undefined {
  if (total === 0) return undefined
  if (venues.recordedPct < THIN) {
    return `Only ${Math.round(venues.recordedPct)}% of meals say where — too few to read much into.`
  }
  const parts = [plural(total, 'recorded meal')]
  const out = venues.outDays.meanOverTarget
  const home = venues.homeDays.meanOverTarget
  if (out !== null && home !== null) {
    parts.push(`days out ${signed(out)} kcal vs target, days at home ${signed(home)}`)
  } else if (venues.outDays.meanKcal !== null && venues.homeDays.meanKcal !== null) {
    parts.push(
      `${venues.outDays.meanKcal.toLocaleString()} kcal on days out, ${venues.homeDays.meanKcal.toLocaleString()} on days at home`,
    )
  }
  return parts.join(' · ')
}


/**
 * What you cook, by cuisine.
 *
 * Plain rows rather than a pie: a pie of six near-equal slices communicates nothing, and this is a
 * list people read as a list — "four Italian, two Indian, none of anything else in a month" is the
 * useful shape. Recipes only, and it says so, because a food row has no cuisine to read.
 */
export function CuisineMixCard({ cuisines }: { cuisines: CuisineShare[] }) {
  const total = cuisines.reduce((sum, row) => sum + row.occasions, 0)

  if (total === 0) {
    return (
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">What you cook</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Log one of your recipes to fill this in.
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">What you cook</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        {plural(total, 'recipe serving')} over the window
      </p>
      <ul className="mt-2.5 space-y-2">
        {cuisines.map((row) => (
          <li key={row.cuisine ?? 'none'}>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-ink-secondary">
                {row.cuisine ? CUISINE_LABELS[row.cuisine] : 'No cuisine set'}
              </span>
              <span className="tabular text-ink-muted">
                {row.occasions} · {row.kcal} kcal
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(row.occasions / total) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
