import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameMonth,
  startOfMonth,
} from 'date-fns'
import type { WorkoutSummary } from '@/data/repository'
import type { Region } from '@/domain/types'
import { dayStart, type WeekStart } from '@/lib/dates'
import { regionVar } from '@/lib/palette'
import { cn } from '@/lib/cn'

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

interface DayInfo {
  count: number
  regions: Region[]
}

export function HistoryCalendar({
  summaries,
  weekStartsOn,
  selectedDay,
  onSelectDay,
}: {
  summaries: WorkoutSummary[]
  weekStartsOn: WeekStart
  // Midnight ts of the selected day, or null for "no day filter".
  selectedDay: number | null
  onSelectDay: (day: number | null) => void
}) {
  const byDay = useMemo(() => {
    const map = new Map<number, DayInfo>()
    for (const summary of summaries) {
      const key = dayStart(summary.workout.startedAt)
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
        for (const r of summary.regions) {
          if (!existing.regions.includes(r)) existing.regions.push(r)
        }
      } else {
        map.set(key, { count: 1, regions: [...summary.regions] })
      }
    }
    return map
  }, [summaries])

  const { earliest } = useMemo(() => {
    let earliest = Infinity
    for (const s of summaries) {
      const at = s.workout.startedAt
      if (at < earliest) earliest = at
    }
    return { earliest }
  }, [summaries])

  // Open on this month, not the last workout's: after a break the calendar
  // otherwise opens in the past with a disabled "next" and no way back to today.
  const [cursor, setCursor] = useState(() => startOfMonth(Date.now()).getTime())

  const cells = useMemo(() => {
    const monthStart = startOfMonth(cursor)
    const monthEnd = endOfMonth(cursor)
    // Pad to whole weeks, honoring the user's week-start.
    const leadingBlanks = (monthStart.getDay() - weekStartsOn + 7) % 7
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
    return { leadingBlanks, days, monthStart }
  }, [cursor, weekStartsOn])

  const canGoBack = earliest < Infinity && cursor > startOfMonth(earliest).getTime()
  const canGoForward = cursor < startOfMonth(Date.now()).getTime()

  const orderedInitials = Array.from(
    { length: 7 },
    (_, i) => DAY_INITIALS[(i + weekStartsOn) % 7]!,
  )

  return (
    <div className="mb-3 rounded-2xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[15px] font-bold tracking-tight">
          {format(cursor, 'MMMM yyyy')}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(addMonths(cursor, -1).getTime())}
            disabled={!canGoBack}
            aria-label="Previous month"
            className="flex size-8 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken disabled:opacity-30"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setCursor(addMonths(cursor, 1).getTime())}
            disabled={!canGoForward}
            aria-label="Next month"
            className="flex size-8 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {orderedInitials.map((initial, i) => (
          <div
            key={i}
            className="pb-1 text-center text-[11px] font-semibold uppercase text-ink-muted"
          >
            {initial}
          </div>
        ))}

        {Array.from({ length: cells.leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}

        {cells.days.map((date) => {
          const key = dayStart(date.getTime())
          const info = byDay.get(key)
          const isSelected = selectedDay === key
          const isToday = key === dayStart(Date.now())

          return (
            <button
              key={key}
              onClick={() => onSelectDay(isSelected ? null : key)}
              aria-label={`${format(date, 'MMMM d')}${info ? `, ${info.count} workout${info.count > 1 ? 's' : ''}` : ''}`}
              aria-pressed={isSelected}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-[13px]',
                isSelected
                  ? 'bg-accent font-bold text-accent-contrast'
                  : info
                    ? 'font-semibold text-ink active:bg-sunken'
                    : 'text-ink-muted active:bg-sunken',
                !isSameMonth(date, cells.monthStart) && 'opacity-40',
              )}
            >
              <span className={cn(isToday && !isSelected && 'text-accent')}>
                {date.getDate()}
              </span>
              {/* Selected day shows white dots so they read on the accent fill. */}
              <span className="flex h-1.5 items-center gap-0.5">
                {info?.regions.slice(0, 3).map((region) => (
                  <span
                    key={region}
                    className="size-1.5 rounded-full"
                    style={{
                      background: isSelected
                        ? 'rgba(255,255,255,0.9)'
                        : regionVar(region),
                    }}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
