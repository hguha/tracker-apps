import { Screen } from '@tracker-engine/ui'
import { EatingWindowCard } from './EatingWindowCard'
import { PreferencesCard } from './PreferencesCard'
import { RemindersCard } from './RemindersCard'
import { WaterTargetCard } from './WaterTargetCard'

export function PreferencesScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="Food, water & reminders" onBack={onBack}>
      <PreferencesCard />
      <RemindersCard />
      <WaterTargetCard />
      <EatingWindowCard />
    </Screen>
  )
}
