import { useLiveQuery } from 'dexie-react-hooks'
import { Card, Screen } from '@tracker-engine/ui'
import { isNativePlatform } from '@tracker-engine/platform'
import * as repo from '@/data/repository'
import { syncReminders } from '@/data/reminders'
import { cn } from '@tracker-engine/core'
import { formatClock, parseClock } from '@/lib/mealTiming'
import { MEAL_LABELS } from '@/lib/meals'
import { DEFAULT_REMINDERS, MEAL_SLOTS, type MealSlot, type RemindersConfig } from '@/domain/types'

/**
 * Reminders, on their own screen, at whatever times you keep.
 *
 * Two things were wrong with the card this replaces. It was the third thing down inside "Food, water
 * & reminders", which is not a place anyone looks for a notification setting; and each meal offered
 * **five half-hourly presets**, so anybody whose lunch is at 12:15 simply could not be reminded about
 * it. A time is a time — the platform has a picker for it.
 *
 * The one property that decides whether any of this is worth having is unchanged: **each nudge only
 * fires if that thing is still undone when the time comes.** There's no hook that runs at fire time on
 * either platform, so it's done by cancelling and rescheduling from current state on every log, boot
 * and resume — see `data/reminders`. Without it the app tells someone who logged lunch two hours ago
 * that they haven't, and they switch the whole lot off, including the ones that would have worked.
 */
export function RemindersScreen({ onBack }: { onBack: () => void }) {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  const save = (next: RemindersConfig | null) => {
    void repo.setReminders(next).then(() => syncReminders())
  }

  // `undefined` means the profile hasn't loaded; rendering "off" for a frame would flip the switch
  // under the user's finger.
  const config = profile?.reminders

  return (
    <Screen title="Reminders" onBack={onBack}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-ink-muted">
              Each one only arrives if it&rsquo;s still undone. Log breakfast and the breakfast
              reminder doesn&rsquo;t come.
            </p>
          </div>
          {profile && (
            <button
              onClick={() => save(config ? null : DEFAULT_REMINDERS)}
              aria-label="Reminders"
              aria-pressed={config !== null && config !== undefined}
              className={cn(
                'h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors',
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
          )}
        </div>
      </Card>

      {config && (
        <>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {/* Driven by the slot list, not by what happens to be stored: a config written before
                  snacks were offered has three rows, and the missing one must still be settable. */}
              {MEAL_SLOTS.map((slot) => {
                const row = config.meals.find((meal) => meal.meal === slot)
                return (
                  <Row
                    key={slot}
                    label={`${MEAL_LABELS[slot]} not logged`}
                    enabled={row?.enabled ?? false}
                    minute={row?.minute ?? defaultMinute(slot)}
                    onChange={(next) => save({ ...config, meals: withMeal(config.meals, slot, next) })}
                  />
                )
              })}
              <Row
                label="Nothing logged at all"
                enabled={config.endOfDay.enabled}
                minute={config.endOfDay.minute}
                onChange={(next) => save({ ...config, endOfDay: next })}
              />
              <Row
                label="Weigh in"
                enabled={config.weighIn.enabled}
                minute={config.weighIn.minute}
                onChange={(next) => save({ ...config, weighIn: next })}
              />
            </ul>
          </Card>

          {!isNativePlatform() && (
            <p className="px-1 text-[12px] text-ink-muted">
              Reminders arrive on the installed app, not in a browser tab.
            </p>
          )}
        </>
      )}
    </Screen>
  )
}

/** One reminder: whether it fires, and when. A tickbox and a clock, nothing else. */
function Row({
  label,
  enabled,
  minute,
  onChange,
}: {
  label: string
  enabled: boolean
  minute: number
  onChange: (next: { minute: number; enabled: boolean }) => void
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <button
        onClick={() => onChange({ minute, enabled: !enabled })}
        role="checkbox"
        aria-checked={enabled}
        aria-label={label}
        className={cn(
          'flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-2',
          enabled ? 'border-accent bg-accent text-accent-contrast' : 'border-line-strong text-transparent',
        )}
      >
        <Tick />
      </button>
      <span className="min-w-0 flex-1 truncate text-[14px]">{label}</span>
      <input
        type="time"
        value={formatClock(minute)}
        disabled={!enabled}
        onChange={(event) => {
          const next = parseClock(event.target.value)
          // A half-typed time reads as null from the picker; ignoring it keeps the stored value.
          if (next !== null) onChange({ minute: next, enabled })
        }}
        aria-label={`${label} time`}
        className="tabular shrink-0 rounded-lg bg-sunken px-2 py-1.5 text-[13.5px] outline-none disabled:opacity-40"
      />
    </li>
  )
}

const withMeal = (
  meals: RemindersConfig['meals'],
  slot: MealSlot,
  next: { minute: number; enabled: boolean },
): RemindersConfig['meals'] =>
  meals.some((meal) => meal.meal === slot)
    ? meals.map((meal) => (meal.meal === slot ? { ...meal, ...next } : meal))
    : [...meals, { meal: slot, ...next }]

const defaultMinute = (slot: MealSlot): number =>
  DEFAULT_REMINDERS.meals.find((meal) => meal.meal === slot)?.minute ?? 12 * 60

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
