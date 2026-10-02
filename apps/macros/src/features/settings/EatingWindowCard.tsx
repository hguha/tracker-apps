import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { formatClock, formatDuration } from '@/lib/mealTiming'

/** Common windows, so nobody has to think in minutes-from-midnight. */
const PRESETS: { label: string; startMinute: number; endMinute: number }[] = [
  { label: '16:8 · noon–8pm', startMinute: 12 * 60, endMinute: 20 * 60 },
  { label: '14:10 · 10am–8pm', startMinute: 10 * 60, endMinute: 20 * 60 },
  { label: '18:6 · 1pm–7pm', startMinute: 13 * 60, endMinute: 19 * 60 },
  { label: 'Daytime · 7am–7pm', startMinute: 7 * 60, endMinute: 19 * 60 },
]

/**
 * An eating window, for anyone who keeps one.
 *
 * What it changes is stated plainly, because the honest list is short: fasting doesn't alter a
 * day's arithmetic, so this adjusts what the app *says* — a fasting timer, pacing that knows when
 * your day starts, and a coach that stops suggesting breakfast.
 */
export function EatingWindowCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  if (!profile) return null
  const current = profile.eatingWindow

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Eating window</h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Shows a fasting timer and whether you&rsquo;re inside your window. Targets don&rsquo;t change.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          onClick={() => void repo.saveProfile({ eatingWindow: null })}
          className={
            current === null
              ? 'rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast'
              : 'rounded-full bg-sunken px-3 py-1.5 text-[13px] text-ink-secondary'
          }
        >
          I eat whenever
        </button>
        {PRESETS.map((preset) => {
          const isActive =
            current?.startMinute === preset.startMinute && current?.endMinute === preset.endMinute
          return (
            <button
              key={preset.label}
              onClick={() =>
                void repo.saveProfile({
                  eatingWindow: { startMinute: preset.startMinute, endMinute: preset.endMinute },
                })
              }
              className={
                isActive
                  ? 'rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast'
                  : 'rounded-full bg-sunken px-3 py-1.5 text-[13px] text-ink-secondary'
              }
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      {current && (
        <>
          <div className="mt-3 flex items-end gap-2">
            <TimeField
              label="Opens"
              minute={current.startMinute}
              onChange={(startMinute) =>
                void repo.saveProfile({ eatingWindow: { ...current, startMinute } })
              }
            />
            <TimeField
              label="Closes"
              minute={current.endMinute}
              onChange={(endMinute) =>
                void repo.saveProfile({ eatingWindow: { ...current, endMinute } })
              }
            />
          </div>
          <p className="tabular mt-2 text-[12px] text-ink-muted">
            {formatClock(current.startMinute)}–{formatClock(current.endMinute)} ·{' '}
            {formatDuration(windowLength(current.startMinute, current.endMinute))} eating,{' '}
            {formatDuration(24 * 60 - windowLength(current.startMinute, current.endMinute))} fasting
          </p>
        </>
      )}
    </Card>
  )
}

function TimeField({
  label,
  minute,
  onChange,
}: {
  label: string
  minute: number
  onChange: (minute: number) => void
}) {
  return (
    <label className="flex-1">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <input
        type="time"
        value={formatClock(minute)}
        onChange={(event) => {
          const [hours, minutes] = event.target.value.split(':').map(Number)
          if (hours === undefined || Number.isNaN(hours)) return
          onChange(hours * 60 + (minutes ?? 0))
        }}
        className="tabular mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[14px] outline-none"
      />
    </label>
  )
}

/** A window ending at or before it starts crosses midnight. */
const windowLength = (startMinute: number, endMinute: number): number =>
  endMinute > startMinute ? endMinute - startMinute : 24 * 60 - startMinute + endMinute
