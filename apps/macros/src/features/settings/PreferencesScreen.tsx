import { Screen } from '@tracker-engine/ui'
import { EatingWindowCard } from './EatingWindowCard'
import { PreferencesCard } from './PreferencesCard'

export function PreferencesScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="Food & units" onBack={onBack}>
      <PreferencesCard />
      <EatingWindowCard />
    </Screen>
  )
}
