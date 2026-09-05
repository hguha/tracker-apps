import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, useToast } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { grams } from '@/features/shared/format'
import type { CheckIn } from '@/domain/types'

/**
 * The weekly proposal, in collaborative mode. Shows the reasoning, not just the number: a
 * target the user doesn't understand is a target they quietly ignore.
 */
export function CheckInCard() {
  const toast = useToast()
  const pending = useLiveQuery(() => repo.pendingCheckIn(), [], undefined)
  if (!pending) return null

  return (
    <Card className="border-accent/40 p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">New targets for this week</h2>
      <Numbers checkIn={pending} />
      <p className="mt-2 text-[12.5px] text-ink-secondary">{pending.note}</p>

      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          onClick={() => {
            void repo.applyCheckIn(pending.id).then(() => toast.show('Targets updated'))
          }}
        >
          Use these
        </Button>
        <button
          onClick={() => {
            void repo.declineCheckIn(pending.id).then(() => toast.show('Keeping your targets'))
          }}
          className="flex-1 rounded-xl bg-sunken py-2.5 text-[14px] font-semibold text-ink-secondary active:opacity-60"
        >
          Keep current
        </button>
      </div>
    </Card>
  )
}

export function Numbers({ checkIn }: { checkIn: CheckIn }) {
  return (
    <>
      <p className="tabular mt-1 text-[22px] font-bold leading-tight">
        {checkIn.targets.kcal}
        <span className="text-[13px] font-medium text-ink-muted"> kcal/day</span>
      </p>
      <p className="tabular text-[12.5px] text-ink-muted">
        {grams(checkIn.targets.proteinMg)} protein · {grams(checkIn.targets.carbsMg)} carbs ·{' '}
        {grams(checkIn.targets.fatMg)} fat
      </p>
    </>
  )
}
