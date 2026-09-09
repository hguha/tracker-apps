import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Screen, useToast } from '@tracker-engine/ui'
import { RefreshCw } from 'lucide-react'
import * as repo from '@/data/repository'
import { CheckInHistory } from '@/features/insights/CheckInHistory'
import { Numbers } from './CheckInCard'

/** The week needs this much before an expenditure estimate means anything. */
const MIN_DAYS = 4
const MIN_WEIGH_INS = 3

/**
 * What the weekly check-in is, where it currently stands, and a button to run it now.
 *
 * The forced run exists because the process was invisible: targets changed on their own, or
 * didn't, with nothing on screen to say which week was measured or what it was missing. Forcing
 * is safe — a check-in's id is derived from (user, week), so a re-run overwrites that week
 * instead of adding a second, contradictory one.
 */
export function CheckInScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const [isRunning, setIsRunning] = useState(false)
  const status = useLiveQuery(() => repo.checkInStatus(), [], undefined)

  const enoughDays = (status?.daysLogged ?? 0) >= MIN_DAYS
  const enoughWeighIns = (status?.weighIns ?? 0) >= MIN_WEIGH_INS
  const canRun = enoughDays && enoughWeighIns

  return (
    <Screen title="Weekly check-in" onBack={onBack}>
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">How it works</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Once a week the app compares what you ate against what your weight trend actually did,
          and works backwards to what you burned:{' '}
          <span className="tabular">expenditure = mean intake − energy change ÷ days</span>. Your
          calorie target is then set from that measurement, not from a formula — which is why it
          keeps working when your metabolism adapts, and why it needs both halves of the data.
        </p>
        <p className="mt-2 text-[13px] text-ink-secondary">
          Targets move gradually, at most 150 kcal a week, so one noisy week can&rsquo;t whipsaw
          you. In <strong>Coached</strong> mode the new target applies itself; in{' '}
          <strong>Ask me</strong> it waits for a tap on Today; in <strong>Manual</strong> nothing
          changes unless you run it here.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Week of {status?.weekStart ?? '—'}
        </h2>
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
            <p className="mt-1 text-[12.5px] text-ink-secondary">{status.existing.note}</p>
          </div>
        ) : status?.outcome?.kind === 'ready' ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[12.5px] text-ink-muted">A run now would set:</p>
            <p className="tabular mt-1 text-[22px] font-bold leading-tight">
              {status.outcome.draft.targets.kcal}
              <span className="text-[13px] font-medium text-ink-muted"> kcal/day</span>
            </p>
            <p className="mt-1 text-[12.5px] text-ink-secondary">{status.outcome.draft.note}</p>
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
        {!canRun && (
          <p className="mt-2 text-[12px] text-ink-muted">
            Log the missing days and weigh-ins for that week first — back-dating them from the Add
            food screen counts.
          </p>
        )}
      </Card>

      <CheckInHistory />
    </Screen>
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
