import { ChevronRight } from 'lucide-react'
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
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-1 py-2 text-[13px] font-semibold text-ink-secondary">
          <ChevronRight size={15} className="transition-transform group-open:rotate-90" />
          Calorie cycling &amp; diet breaks
        </summary>
        <div className="space-y-3">
          <CyclingCard />
          <DietBreakCard />
        </div>
      </details>
    </Screen>
  )
}
