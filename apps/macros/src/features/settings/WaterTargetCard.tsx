import { useLiveQuery } from 'dexie-react-hooks'
import { cn, formatVolume } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { useUnits } from '@/features/shared/useUnits'

/** Round numbers in both systems, so neither reads as a converted approximation of the other. */
const METRIC_TARGETS = [1500, 2000, 2500, 3000]
const IMPERIAL_TARGETS = [1420, 1893, 2366, 2839] // 48, 64, 80, 96 fl oz

export function WaterTargetCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const units = useUnits()
  if (!profile) return null

  const options = units.volume === 'floz' ? IMPERIAL_TARGETS : METRIC_TARGETS
  const current = profile.waterTargetMl

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Water target</h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Optional. Without one the glass on Today still counts what you drink — it just fills against a
        two-litre day rather than against a goal.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Pill isActive={current === null} onClick={() => void repo.setWaterTarget(null)}>
          None
        </Pill>
        {options.map((ml) => (
          <Pill key={ml} isActive={current === ml} onClick={() => void repo.setWaterTarget(ml)}>
            {formatVolume(ml, units.volume)}
          </Pill>
        ))}
      </div>
    </Card>
  )
}

function Pill({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'tabular rounded-full px-3 py-1.5 text-[13px]',
        isActive
          ? 'bg-accent font-semibold text-accent-contrast'
          : 'bg-sunken text-ink-secondary',
      )}
    >
      {children}
    </button>
  )
}
