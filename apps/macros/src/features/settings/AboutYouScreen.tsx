import { Screen } from '@tracker-engine/ui'
import { WeighInCard } from '@/features/today/WeighInCard'
import { AboutYouCard } from './AboutYouCard'
import { HealthCard } from './HealthCard'

export function AboutYouScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="About you" onBack={onBack}>
      <AboutYouCard />
      {/* Here as well as on Today: a first target needs a weight, and this is where someone
          sent to "fill that in" arrives. */}
      <WeighInCard />
      <HealthCard />
    </Screen>
  )
}
