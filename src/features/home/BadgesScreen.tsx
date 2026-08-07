/**
 * The full badge catalog (§5.2.1), reached from More.
 *
 * Home shows only badges in play (earned or started); the complete set lives
 * here, grouped into themed sections, each badge tappable for its description
 * and progress. Reads the same lifetime stats and catalog as Home, so the two
 * can never disagree about what's earned.
 */

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { computeStreaks } from './streaks'
import { evaluateBadges, groupedBadges, type BadgeState } from './badges'
import { BadgeDetailSheet, BadgeTile } from './BadgeUI'

export function BadgesScreen({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<BadgeState | null>(null)

  const badges = useLiveQuery(async () => {
    const summaries = await repo.listWorkoutSummaries(1000)
    const finished = summaries.filter((s) => s.workout.endedAt !== null)
    const stats = await repo.getBadgeStats()
    const profile = await repo.getProfile()

    // Same streak helper Home uses, so a badge evaluates identically here.
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
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Badges</h1>
        {badges && (
          <span className="pr-2 text-[13px] text-ink-muted">
            {earnedCount} of {badges.length}
          </span>
        )}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {!badges ? (
          <div className="p-6 text-ink-muted">Loading…</div>
        ) : (
          sections.map((section) => (
            <Card key={section.group} className="p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                {section.group}
              </p>
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
          ))
        )}
        <div className="h-4" />
      </div>

      {selected && (
        <BadgeDetailSheet badge={selected} onDismiss={() => setSelected(null)} />
      )}
    </div>
  )
}
