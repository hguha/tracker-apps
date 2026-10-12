import { useState } from 'react'
import { ScreenHeader, SectionLabel } from '@tracker-engine/ui'
import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { computeStreaks } from './streaks'
import { evaluateBadges, groupedBadges, type BadgeState } from './badges'
import { BadgeDetailSheet, BadgeTile } from './BadgeUI'

export function BadgesScreen({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<BadgeState | null>(null)

  const badges = useLiveQuery(async () => {
    const finished = await repo.listFinishedWorkoutSummaries(1000)
    const stats = await repo.getBadgeStats()
    const profile = await repo.getProfile()

    const { currentWeekStreak, bestWeekStreak } = computeStreaks(
      finished.map((s) => s.workout.startedAt),
      profile.weekStartsOn,
    )

    return evaluateBadges({
      totalWorkouts: finished.length,
      totalSets: finished.reduce((t, s) => t + s.setCount, 0),
      totalVolumeKg: finished.reduce((t, s) => t + s.volumeKg, 0),
      bestWeekStreak,
      currentWeekStreak,
      ...stats,
    })
  }, [])

  const earnedCount = badges?.filter((b) => b.earned).length ?? 0
  const sections = badges ? groupedBadges(badges) : []

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Badges"
        onBack={onBack}
        action={
          badges && (
            <span className="pr-2 text-[13px] text-ink-muted">
              {earnedCount} of {badges.length}
            </span>
          )
        }
      />

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {badges &&
          sections.map((section) => (
            <Card key={section.group} className="p-4">
              <SectionLabel>
                {section.group}
              </SectionLabel>
              <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-4">
                {section.badges.map((badge) => (
                  <BadgeTile
                    key={badge.key}
                    badge={badge}
                    showProgress
                    onClick={() => setSelected(badge)}
                  />
                ))}
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
