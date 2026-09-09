import { Screen } from '@tracker-engine/ui'
import { CyclingCard } from './CyclingCard'
import { DietBreakCard } from './DietBreakCard'
import { TargetsCard } from './TargetsCard'

export function TargetsScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="Targets & goal" onBack={onBack}>
      <TargetsCard />
      <CyclingCard />
      <DietBreakCard />
    </Screen>
  )
}
