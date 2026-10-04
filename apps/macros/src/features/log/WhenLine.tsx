import { useState } from 'react'
import { cn, formatRelativeDay, formatTimeOfDay } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { ChevronDown, Utensils } from 'lucide-react'
import { MEAL_LABELS } from '@/lib/meals'
import type { MealSlot } from '@/domain/types'
import { MealTimePicker } from './MealTimePicker'

export function WhenLine({
  meal,
  at,
  onMeal,
  onAt,
}: {
  meal: MealSlot
  at: number
  onMeal: (meal: MealSlot) => void
  onAt: (at: number) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1.5 rounded-xl bg-sunken px-3 py-2 text-left text-[13px] active:opacity-60"
      >
        <Utensils size={13} className="shrink-0 text-ink-muted" />
        <span className="font-medium">{MEAL_LABELS[meal]}</span>
        <span className="tabular min-w-0 flex-1 truncate text-ink-muted">
          · {formatRelativeDay(at)} {formatTimeOfDay(at)}
        </span>
        <ChevronDown
          size={15}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && (
        <Card className="mt-2 p-3">
          <MealTimePicker meal={meal} at={at} onMeal={onMeal} onAt={onAt} />
        </Card>
      )}
    </div>
  )
}
