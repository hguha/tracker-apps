import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, useToast } from '@tracker-engine/ui'
import { RefreshCw } from 'lucide-react'
import * as repo from '@/data/repository'
import { describeCheckIn } from '@/lib/checkin'
import { useUnits } from '@/features/shared/useUnits'
import { Numbers } from './CheckInCard'

/** The week needs this much before an expenditure estimate means anything. */
const MIN_DAYS = 4
const MIN_WEIGH_INS = 3

export function CheckInStatusCard() {
  const toast = useToast()
  const [isRunning, setIsRunning] = useState(false)
  const status = useLiveQuery(() => repo.checkInStatus(), [], undefined)
  const units = useUnits()

  const enoughDays = (status?.daysLogged ?? 0) >= MIN_DAYS
  const enoughWeighIns = (status?.weighIns ?? 0) >= MIN_WEIGH_INS
  const canRun = enoughDays && enoughWeighIns

  return (
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Weekly check-in</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          Week of {status?.weekStart ?? '—'} · moves at most 150 kcal a week
        </p>
        <dl className="mt-2 space-y-1.5 text-[13.5px]">
          <Row label="Days logged" ok={enoughDays}>
            {status?.daysLogged ?? '—'} of {MIN_DAYS} needed
          </Row>
          <Row label="Weigh-ins" ok={enoughWeighIns}>
            {status?.weighIns ?? '—'} of {MIN_WEIGH_INS} needed
          </Row>
          <Row label="Mode" ok>
            {status?.coachingMode ?? '—'}
          </Row>
        </dl>

        {status?.existing ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[12.5px] text-ink-muted">
              Already run for this week ({status.existing.status}).
            </p>
            <Numbers checkIn={status.existing} />
            <p className="mt-1 text-[12.5px] text-ink-secondary">{describeCheckIn(status.existing, units.weight)}</p>
          </div>
        ) : status?.outcome?.kind === 'ready' ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[12.5px] text-ink-muted">A run now would set:</p>
            <p className="tabular mt-1 text-[22px] font-bold leading-tight">
              {status.outcome.draft.targets.kcal}
              <span className="text-[13px] font-medium text-ink-muted"> kcal/day</span>
            </p>
            <p className="mt-1 text-[12.5px] text-ink-secondary">{describeCheckIn(status.outcome.draft, units.weight)}</p>
          </div>
        ) : (
          <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-muted">
            {status?.outcome?.kind === 'not-enough-data'
              ? status.outcome.reason
              : 'Pick a goal first, and log a few days.'}
          </p>
        )}

        <Button
          variant="secondary"
          className="mt-3 w-full"
          disabled={isRunning || !canRun}
          onClick={() => {
            setIsRunning(true)
            void repo
              .runCheckIn(Date.now(), { force: true })
              .then((checkIn) =>
                toast.show(
                  checkIn
                    ? `Target set to ${checkIn.targets.kcal} kcal`
                    : 'Not enough data for this week yet',
                ),
              )
              .finally(() => setIsRunning(false))
          }}
        >
          <RefreshCw size={16} />
          {isRunning ? 'Working it out…' : 'Run the check-in now'}
        </Button>
      </Card>
  )
}

function Row({
  label,
  ok,
  children,
}: {
  label: string
  ok: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-secondary">{label}</dt>
      <dd
        className="tabular font-semibold"
        style={ok ? undefined : { color: 'var(--status-serious)' }}
      >
        {children}
      </dd>
    </div>
  )
}
