import { useState } from 'react'
import { BadgeGrid, ScreenHeader, SectionLabel, type BadgeView } from '@tracker-engine/ui'
import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { evaluateBadges, groupedBadges, lifetimeStats } from './badges'
import { BadgeDetailSheet } from './BadgeUI'

export function BadgesScreen({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<BadgeView | null>(null)

  const badges = useLiveQuery(async () => {
    const finished = await repo.listFinishedWorkoutSummaries(1000)
    const stats = await repo.getBadgeStats()
    const profile = await repo.getProfile()

    return evaluateBadges(lifetimeStats(finished, profile.weekStartsOn, stats))
  }, [])

  const earnedCount = badges?.filter((b) => b.earned).length ?? 0
  const sections = badges ? groupedBadges(badges) : []

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Badges" onBack={onBack} />

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {badges && (
          <Card className="p-4">
            <p className="tabular text-[22px] font-bold leading-tight">
              {earnedCount}
              <span className="text-[13px] font-medium text-ink-muted">
                {' '}
                of {badges.length} earned
              </span>
            </p>
          </Card>
        )}
        {badges &&
          sections.map((section) => (
            <Card key={section.group} className="p-4">
              <SectionLabel>
                {section.group}
              </SectionLabel>
              <div className="mt-3">
                <BadgeGrid badges={section.badges} onSelect={setSelected} />
              </div>
            </Card>
          ))}
        <div className="h-4" />
      </div>

      {selected && (
        <BadgeDetailSheet badge={selected} onDismiss={() => setSelected(null)} />
      )}
    </div>
  )
}
