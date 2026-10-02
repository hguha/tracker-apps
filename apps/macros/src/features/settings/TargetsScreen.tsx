import { Screen } from '@tracker-engine/ui'
import { CheckInStatusCard } from '@/features/checkin/CheckInStatusCard'
import { CyclingCard } from './CyclingCard'
import { DietBreakCard } from './DietBreakCard'
import { ManualTargetsCard } from './ManualTargetsCard'
import { TargetsCard } from './TargetsCard'

export function TargetsScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="Targets & goal" onBack={onBack}>
      <TargetsCard />
      <CheckInStatusCard />
      <ManualTargetsCard />
      <CyclingCard />
      <DietBreakCard />
    </Screen>
  )
}
