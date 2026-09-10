import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@tracker-engine/ui'
import { isNativePlatform } from '@tracker-engine/platform'
import * as repo from '@/data/repository'
import { syncReminders } from '@/data/reminders'
import { cn } from '@/lib/cn'
import { formatClock } from '@/lib/mealTiming'
import { MEAL_LABELS } from '@/lib/meals'
import { DEFAULT_REMINDERS, type MealSlot, type RemindersConfig } from '@/domain/types'

/** Half-hour steps across the plausible window for each meal. */
const CHOICES: Record<MealSlot, number[]> = {
  breakfast: [8 * 60, 9 * 60, 9 * 60 + 30, 10 * 60, 11 * 60],
  lunch: [12 * 60 + 30, 13 * 60, 13 * 60 + 30, 14 * 60, 15 * 60],
  dinner: [19 * 60, 19 * 60 + 30, 20 * 60, 20 * 60 + 30, 21 * 60],
  snack: [],
}

const END_CHOICES = [20 * 60, 21 * 60, 21 * 60 + 30, 22 * 60, 22 * 60 + 30]

/**
 * Reminders, and the one property that decides whether they're worth having.
 *
 * **Each nudge only fires if that meal is still unlogged when the time comes.** There's no hook that
 * runs at fire time on either platform, so it's done by cancelling and rescheduling from the current
 * state on every log, boot and resume — see `data/reminders`. Without that, the app would tell someone
 * who logged lunch two hours ago that they hadn't, and they would switch the whole lot off.
 */
export function RemindersCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  if (!profile) return null

  const config = profile.reminders
  const save = (next: RemindersConfig | null) => {
    void repo.setReminders(next).then(() => syncReminders())
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Reminders</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            A nudge if a meal is still unlogged — and only then. Log breakfast and the breakfast
            reminder doesn&rsquo;t arrive.
          </p>
        </div>
        <button
          onClick={() => save(config ? null : DEFAULT_REMINDERS)}
          aria-label="Reminders"
          aria-pressed={config !== null}
          className={cn(
            'mt-0.5 h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors',
            config ? 'bg-accent' : 'bg-sunken',
          )}
        >
          <span
            className={cn(
              'block size-6 rounded-full bg-surface shadow-sm transition-transform',
              config && 'translate-x-5',
            )}
          />
        </button>
      </div>

      {config && (
        <div className="mt-3 space-y-3">
          {config.meals.map((reminder) => (
            <Row
              key={reminder.meal}
              label={MEAL_LABELS[reminder.meal]}
              enabled={reminder.enabled}
              minute={reminder.minute}
              choices={CHOICES[reminder.meal]}
              onToggle={() =>
                save({
                  ...config,
                  meals: config.meals.map((row) =>
                    row.meal === reminder.meal ? { ...row, enabled: !row.enabled } : row,
                  ),
                })
              }
              onMinute={(minute) =>
                save({
                  ...config,
                  meals: config.meals.map((row) =>
                    row.meal === reminder.meal ? { ...row, minute } : row,
                  ),
                })
              }
            />
          ))}

          <Row
            label="Nothing logged"
            hint="Only if the whole day is empty."
            enabled={config.endOfDay.enabled}
            minute={config.endOfDay.minute}
            choices={END_CHOICES}
            onToggle={() =>
              save({ ...config, endOfDay: { ...config.endOfDay, enabled: !config.endOfDay.enabled } })
            }
            onMinute={(minute) => save({ ...config, endOfDay: { ...config.endOfDay, minute } })}
          />

          {!isNativePlatform() && (
            <p className="text-[12px] text-ink-muted">
              These arrive on the installed app. In a browser tab there is nothing to deliver them,
              so they&rsquo;re saved and will start once you install MACROcosm on your phone.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function Row({
  label,
  hint,
  enabled,
  minute,
  choices,
  onToggle,
  onMinute,
}: {
  label: string
  hint?: string
  enabled: boolean
  minute: number
  choices: number[]
  onToggle: () => void
  onMinute: (minute: number) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          aria-pressed={enabled}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-md border',
            enabled ? 'border-accent bg-accent text-accent-contrast' : 'border-line',
          )}
        >
          {enabled && <Tick />}
        </button>
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{label}</span>
        <span className="tabular shrink-0 text-[12.5px] text-ink-muted">{formatClock(minute)}</span>
      </div>
      {hint && <p className="ml-7 text-[12px] text-ink-muted">{hint}</p>}
      {enabled && (
        <div className="ml-7 mt-1.5 flex flex-wrap gap-1.5">
          {choices.map((option) => (
            <button
              key={option}
              onClick={() => onMinute(option)}
              aria-pressed={option === minute}
              className={cn(
                'tabular rounded-full px-2.5 py-1 text-[12px]',
                option === minute
                  ? 'bg-accent font-semibold text-accent-contrast'
                  : 'bg-sunken text-ink-secondary',
              )}
            >
              {formatClock(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 6.5 L4.8 9 L9.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
