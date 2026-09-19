import { Screen } from '@tracker-engine/ui'
import { EatingWindowCard } from './EatingWindowCard'
import { PreferencesCard } from './PreferencesCard'
import { WaterTargetCard } from './WaterTargetCard'

export function PreferencesScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="Food & water" onBack={onBack}>
      <PreferencesCard />
      <WaterTargetCard />
      <EatingWindowCard />
    </Screen>
  )
}
