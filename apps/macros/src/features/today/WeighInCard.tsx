import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { weightTrend } from '@tracker-engine/body'
import { Button, Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'

/** Today's weigh-in, with the trend rather than the raw number — the trend is what any
 *  decision reads, so showing the scale value alone would invite reacting to noise. */
export function WeighInCard() {
  const today = dayKey(Date.now())
  const rows = useLiveQuery(() => repo.weights(), [], [])
  const [value, setValue] = useState('')

  const trend = weightTrend(rows ?? [])
  const todayRow = (rows ?? []).find((row) => row.day === today)
  const latest = trend[trend.length - 1]

  if (todayRow) {
    return (
      <Card className="flex items-baseline justify-between p-4">
        <span className="text-[14px] text-ink-secondary">Weighed in today</span>
        <span className="tabular text-[14px]">
          <span className="font-semibold">{todayRow.kg.toFixed(1)} kg</span>
          {latest && (
            <span className="text-ink-muted"> · trend {latest.trendKg.toFixed(1)}</span>
          )}
        </span>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Weight (kg)"
          className="min-w-0 flex-1 rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
        />
        <Button
          disabled={Number(value) <= 0}
          onClick={() => {
            void repo.recordWeight(Number(value)).then(() => setValue(''))
          }}
        >
          Save
        </Button>
      </div>
      <p className="mt-2 text-[12.5px] text-ink-muted">
        Daily weigh-ins are what let the app measure your expenditure instead of guessing it.
      </p>
    </Card>
  )
}
