import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { cn, formatClock, parseClock } from '@tracker-engine/core'
import { isNativePlatform } from '@tracker-engine/platform'
import { Card, Screen, Switch } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import {
  DEFAULT_REMINDERS,
  readReminders,
  syncWorkoutReminders,
  writeReminders,
  type ReminderPrefs,
} from './reminders'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function RemindersScreen({ onBack }: { onBack: () => void }) {
  const profile = useLiveQuery(() => repo.getProfile(), [])
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(() => readReminders())

  const save = (next: ReminderPrefs | null) => {
    setPrefs(next)
    writeReminders(next)
    void syncWorkoutReminders().catch((error) => console.warn('[reminders] sync failed', error))
  }

  const order = profile?.weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]

  return (
    <Screen title="Reminders" onBack={onBack}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-muted">
            Each one only arrives if it&rsquo;s still undone. Train or weigh in and that
            day&rsquo;s reminder doesn&rsquo;t come.
          </p>
          <Switch
            label="Reminders"
            isOn={prefs !== null}
            onChange={(isOn) => save(isOn ? DEFAULT_REMINDERS : null)}
          />
        </div>
      </Card>

      {prefs && (
        <>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              <Row
                label="No workout yet"
                enabled={prefs.workout.enabled}
                minute={prefs.workout.minute}
                onChange={(next) => save({ ...prefs, workout: { ...prefs.workout, ...next } })}
              >
                <div className="flex gap-1 px-4 pb-3" role="group" aria-label="Workout days">
                  {order.map((day) => {
                    const isOn = prefs.workout.weekdays.includes(day)
                    return (
                      <button
                        key={day}
                        aria-pressed={isOn}
                        disabled={!prefs.workout.enabled}
                        onClick={() =>
                          save({
                            ...prefs,
                            workout: {
                              ...prefs.workout,
                              weekdays: isOn
                                ? prefs.workout.weekdays.filter((d) => d !== day)
                                : [...prefs.workout.weekdays, day],
                            },
                          })
                        }
                        className={cn(
                          'h-9 flex-1 rounded-lg text-[12.5px] font-semibold disabled:opacity-40',
                          isOn ? 'bg-accent text-accent-contrast' : 'bg-sunken text-ink-secondary',
                        )}
                      >
                        {WEEKDAYS[day]}
                      </button>
                    )
                  })}
                </div>
                <p className="px-4 pb-3 text-[12px] text-ink-muted">
                  Skipped once you&rsquo;ve hit this week&rsquo;s workout goal.
                </p>
              </Row>
              <Row
                label="Weigh in"
                enabled={prefs.weighIn.enabled}
                minute={prefs.weighIn.minute}
                onChange={(next) => save({ ...prefs, weighIn: next })}
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

function Row({
  label,
  enabled,
  minute,
  onChange,
  children,
}: {
  label: string
  enabled: boolean
  minute: number
  onChange: (next: { minute: number; enabled: boolean }) => void
  children?: React.ReactNode
}) {
  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange({ minute, enabled: event.target.checked })}
          aria-label={label}
          className="size-5 shrink-0 accent-[var(--accent)]"
        />
        <span className="min-w-0 flex-1 truncate text-[14px]">{label}</span>
        <input
          type="time"
          value={formatClock(minute)}
          disabled={!enabled}
          onChange={(event) => {
            const next = parseClock(event.target.value)
            if (next !== null) onChange({ minute: next, enabled })
          }}
          aria-label={`${label} time`}
          className="tabular shrink-0 rounded-lg bg-sunken px-2 py-1.5 text-[13.5px] outline-none disabled:opacity-40"
        />
      </div>
      {children}
    </li>
  )
}
