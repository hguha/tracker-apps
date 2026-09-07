import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BadgeDetailSheet, BadgeGrid, Card, Screen, type BadgeView } from '@tracker-engine/ui'
import { nutritionStats } from '@/data/stats'
import { evaluateBadges, groupedBadges, type BadgeState } from './catalog'

export function BadgesScreen({ onBack }: { onBack: () => void }) {
  const stats = useLiveQuery(() => nutritionStats(), [], undefined)
  const [selected, setSelected] = useState<BadgeView | null>(null)

  const all: BadgeState[] = stats ? evaluateBadges(stats) : []
  const earned = all.filter((badge) => badge.earned).length

  return (
    <Screen title="Badges" onBack={onBack}>
      <Card className="p-4">
        <p className="tabular text-[22px] font-bold leading-tight">
          {earned}
          <span className="text-[13px] font-medium text-ink-muted"> of {all.length} earned</span>
        </p>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          All of these are for logging honestly and hitting your plan. None of them reward eating
          less than your target — a streak worth chasing shouldn&rsquo;t teach you to under-eat.
        </p>
      </Card>

      {groupedBadges(all).map((section) => (
        <Card key={section.group} className="p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            {section.group}
          </h2>
          <div className="mt-3">
            <BadgeGrid badges={section.badges} onSelect={setSelected} />
          </div>
        </Card>
      ))}

      {selected && <BadgeDetailSheet badge={selected} onDismiss={() => setSelected(null)} />}
    </Screen>
  )
}
