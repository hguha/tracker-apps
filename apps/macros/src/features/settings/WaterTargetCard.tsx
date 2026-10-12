import { useLiveQuery } from 'dexie-react-hooks'
import { formatVolume } from '@tracker-engine/core'
import { Card, PillSelect } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { useUnits } from '@/features/shared/useUnits'

/** Round numbers in both systems, so neither reads as a converted approximation of the other. */
const METRIC_TARGETS = [1500, 2000, 2500, 3000]
const IMPERIAL_TARGETS = [1420, 1893, 2366, 2839] // 48, 64, 80, 96 fl oz
const NONE = 'none'

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
        Without one, Today fills against two litres.
      </p>
      <PillSelect
        className="mt-2.5"
        layout="wrap"
        isRequired
        value={current === null ? NONE : String(current)}
        onChange={(value) => void repo.setWaterTarget(value === NONE ? null : Number(value))}
        options={[
          { value: NONE, label: 'None' },
          ...options.map((ml) => ({ value: String(ml), label: formatVolume(ml, units.volume) })),
        ]}
      />
    </Card>
  )
}
