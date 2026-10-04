import { ChevronRight } from 'lucide-react'
import { Screen } from '@tracker-engine/ui'
import { CheckInStatusCard } from '@/features/checkin/CheckInStatusCard'
import { WeighInCard } from '@/features/today/WeighInCard'
import { AboutYouCard } from './AboutYouCard'
import { CyclingCard } from './CyclingCard'
import { DailyTargetsCard } from './DailyTargetsCard'
import { DietBreakCard } from './DietBreakCard'
import { EatingWindowCard } from './EatingWindowCard'
import { HealthCard } from './HealthCard'
import { TargetRulesCard, TargetsCard } from './TargetsCard'
import { WaterTargetCard } from './WaterTargetCard'

export function TargetsScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen title="Targets & goal" onBack={onBack}>
      <TargetsCard />
      <DailyTargetsCard />
      <WaterTargetCard />
      <CheckInStatusCard />
      <AboutYouCard />
      <WeighInCard />
      <HealthCard />
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-1 py-2 text-[13px] font-semibold text-ink-secondary">
          <ChevronRight size={15} className="transition-transform group-open:rotate-90" />
          More options
        </summary>
        <div className="space-y-3">
          <TargetRulesCard />
          <EatingWindowCard />
          <CyclingCard />
          <DietBreakCard />
        </div>
      </details>
    </Screen>
  )
}
