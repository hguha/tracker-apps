import { useMemo } from 'react'
import { dayStart, plural, type WeekStart } from '@tracker-engine/core'
import { MonthCalendar, type CalendarDay } from '@tracker-engine/ui'
import type { WorkoutSummary } from '@/data/repository'
import type { Region } from '@/domain/types'
import { regionVar } from '@/lib/palette'

export function HistoryCalendar({
  summaries,
  weekStartsOn,
  selectedDay,
  onSelectDay,
}: {
  summaries: WorkoutSummary[]
  weekStartsOn: WeekStart
  selectedDay: number | null
  onSelectDay: (day: number | null) => void
}) {
  const days = useMemo(() => {
    const byDay = new Map<number, { count: number; regions: Set<Region> }>()
    for (const summary of summaries) {
      const key = dayStart(summary.workout.startedAt)
      const day = byDay.get(key) ?? { count: 0, regions: new Set<Region>() }
      day.count += 1
      for (const region of summary.regions) day.regions.add(region)
      byDay.set(key, day)
    }
    return new Map<number, CalendarDay>(
      [...byDay].map(([key, day]) => [
        key,
        { label: plural(day.count, 'workout'), dots: [...day.regions].map(regionVar) },
      ]),
    )
  }, [summaries])

  const earliestAt = summaries.length
    ? summaries.reduce((min, summary) => Math.min(min, summary.workout.startedAt), Infinity)
    : null

  return (
    <MonthCalendar
      days={days}
      weekStartsOn={weekStartsOn}
      selectedDay={selectedDay}
      onSelectDay={onSelectDay}
      earliestAt={earliestAt}
      className="mb-3"
    />
  )
}
