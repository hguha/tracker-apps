import { useLiveQuery } from 'dexie-react-hooks'
import { Flag } from 'lucide-react'
import { convertWeight } from '@tracker-engine/core'
import {
  arrivalDay,
  arrivalRange,
  perWeek,
  timeUntil,
  type ScaleOutlook,
} from '@tracker-engine/body'
import { useDraftInput } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { bodyWeightFromKg, parseNumber, weightToKg } from '@/lib/units'
import type { Profile, WeightUnit } from '@/domain/types'

export function GoalWeightCard({ profile }: { profile: Profile }) {
  const unit = profile.unitWeight
  const outlook = useLiveQuery(() => repo.bodyGoalOutlook(), [profile.goalWeightKg], undefined)
  const goal = useDraftInput({
    value:
      profile.goalWeightKg === null ? '' : String(bodyWeightFromKg(profile.goalWeightKg, unit)),
    onCommit: (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return void repo.setGoalWeight(null)
      const parsed = parseNumber(trimmed)
      if (parsed === null || parsed <= 0) return false
      void repo.setGoalWeight(weightToKg(parsed, unit))
    },
  })

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="body-goal" className="text-[15px] font-semibold tracking-tight">
          Goal weight
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="body-goal"
            inputMode="decimal"
            placeholder="Optional"
            {...goal.inputProps}
            className="tabular h-10 w-24 rounded-lg bg-sunken px-3 text-right text-[15px] outline-none focus:ring-2 focus:ring-accent/40"
          />
          <span className="w-6 text-[13px] text-ink-muted">{unit}</span>
        </div>
      </div>
      {outlook && <GoalProgress outlook={outlook} unit={unit} />}
      {profile.goalWeightKg !== null && outlook === null && (
        <p className="mt-2 text-[12.5px] text-ink-muted">Log your bodyweight to track progress.</p>
      )}
    </Card>
  )
}

function GoalProgress({ outlook, unit }: { outlook: ScaleOutlook; unit: WeightUnit }) {
  const remaining = Math.abs(convertWeight(outlook.progress.remainingKg, unit))
  return (
    <div className="mt-2">
      <p className="tabular text-[13px] text-ink-muted">
        {outlook.progress.isReached ? 'At your goal' : `${remaining.toFixed(1)} ${unit} to go`}
        {outlook.rate && ` · ${perWeek(outlook.rate.kgPerWeek, unit)}`}
      </p>
      {outlook.progress.fraction !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.round(outlook.progress.fraction * 100)}%` }}
          />
        </div>
      )}
      <p className="mt-2 text-[13px]">
        <Headline outlook={outlook} />
      </p>
    </div>
  )
}

function Headline({ outlook }: { outlook: ScaleOutlook }) {
  if (outlook.progress.isReached) {
    return <span className="text-ink-secondary">At your goal. Nice work.</span>
  }
  if (outlook.isWrongWay) {
    return <span style={{ color: 'var(--status-serious)' }}>Trending away from your goal</span>
  }
  if (outlook.likelyAt !== null) {
    const range = arrivalRange(outlook.earliestAt, outlook.latestAt)
    return (
      <span className="flex flex-wrap items-center gap-x-1.5">
        <Flag size={14} className="shrink-0 text-accent" />
        <span className="font-semibold">Likely {arrivalDay(outlook.likelyAt)}</span>
        <span className="tabular text-ink-muted">· {timeUntil(outlook.likelyAt)}</span>
        {range && <span className="w-full text-[12px] text-ink-muted">Range: {range}</span>}
      </span>
    )
  }
  return (
    <span className="text-ink-muted">
      {outlook.rate ? 'Holding steady, so no date yet' : 'Weigh in a few more times for a forecast'}
    </span>
  )
}
