import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, dayStart, type WeekStart } from '@tracker-engine/core'

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export interface CalendarDay {
  dots: readonly string[]
  label: string
}

const monthStart = (ts: number, offset = 0): number => {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth() + offset, 1).getTime()
}

const daysOfMonth = (start: number): number[] => {
  const date = new Date(start)
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Array.from({ length: count }, (_, i) =>
    new Date(date.getFullYear(), date.getMonth(), i + 1).getTime(),
  )
}

export function MonthCalendar({
  days,
  weekStartsOn,
  selectedDay,
  onSelectDay,
  earliestAt,
  className,
}: {
  days: ReadonlyMap<number, CalendarDay>
  weekStartsOn: WeekStart
  selectedDay: number | null
  onSelectDay: (day: number | null) => void
  earliestAt: number | null
  className?: string
}) {
  const [cursor, setCursor] = useState(() => monthStart(Date.now()))
  const leadingBlanks = (new Date(cursor).getDay() - weekStartsOn + 7) % 7
  const canGoBack = earliestAt !== null && cursor > monthStart(earliestAt)
  const canGoForward = cursor < monthStart(Date.now())
  const today = dayStart(Date.now())
  const initials = Array.from({ length: 7 }, (_, i) => DAY_INITIALS[(i + weekStartsOn) % 7]!)

  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-3', className)}>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[15px] font-bold tracking-tight">
          {new Date(cursor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(monthStart(cursor, -1))}
            disabled={!canGoBack}
            aria-label="Previous month"
            className="flex size-8 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken disabled:opacity-30"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setCursor(monthStart(cursor, 1))}
            disabled={!canGoForward}
            aria-label="Next month"
            className="flex size-8 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {initials.map((initial, i) => (
          <div key={i} className="pb-1 text-center text-[11px] font-semibold uppercase text-ink-muted">
            {initial}
          </div>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {daysOfMonth(cursor).map((date) => {
          const key = dayStart(date)
          const info = days.get(key)
          const isSelected = selectedDay === key
          const name = new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
          return (
            <button
              key={key}
              onClick={() => onSelectDay(isSelected ? null : key)}
              aria-label={info ? `${name}, ${info.label}` : name}
              aria-pressed={isSelected}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-[13px]',
                isSelected
                  ? 'bg-accent font-bold text-accent-contrast'
                  : info
                    ? 'font-semibold text-ink active:bg-sunken'
                    : 'text-ink-muted active:bg-sunken',
              )}
            >
              <span className={cn(key === today && !isSelected && 'text-accent')}>
                {new Date(date).getDate()}
              </span>
              <span className="flex h-1.5 items-center gap-0.5">
                {info?.dots.slice(0, 3).map((color, i) => (
                  <span
                    key={i}
                    className="size-1.5 rounded-full"
                    style={{ background: isSelected ? 'rgba(255,255,255,0.9)' : color }}
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
