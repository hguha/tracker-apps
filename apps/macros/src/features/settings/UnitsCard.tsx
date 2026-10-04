import { useLiveQuery } from 'dexie-react-hooks'
import { Card, PillSelect } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import type { UnitSystem } from '@/domain/types'

const UNITS: { value: UnitSystem; label: string }[] = [
  { value: 'metric', label: 'kg / cm' },
  { value: 'imperial', label: 'lb / in' },
]

export function UnitsCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  if (!profile) return null
  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Units</h2>
      <div className="mt-2">
        <PillSelect
          value={profile.units}
          options={UNITS}
          onChange={(units) => void repo.saveProfile({ units: units ?? 'metric' })}
        />
      </div>
    </Card>
  )
}
