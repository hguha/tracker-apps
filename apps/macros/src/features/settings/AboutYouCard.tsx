import { useLiveQuery } from 'dexie-react-hooks'
import { lengthFromCm, lengthToCm } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { ActivityPicker } from '@/features/shared/ActivityPicker'
import { useUnits } from '@/features/shared/useUnits'

/**
 * Height, age and sex exist only to seed the very first target, before any week of data
 * qualifies. Once it does, they stop mattering — which is worth saying, since every other
 * tracker treats them as the answer rather than the guess.
 */
export function AboutYouCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const units = useUnits()
  if (!profile) return null

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">About you</h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Sets your starting target. After a week, your logs take over.
      </p>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <Field
          // Stored in cm always; this is the only place inches exist.
          label={`Height (${units.length})`}
          value={profile.heightCm === null ? null : lengthFromCm(profile.heightCm, units.length)}
          onChange={(value) =>
            void repo.saveProfile({
              heightCm: value === null ? null : lengthToCm(value, units.length),
            })
          }
        />
        <Field
          label="Birth year"
          value={profile.birthYear}
          onChange={(birthYear) => void repo.saveProfile({ birthYear })}
        />
        <label>
          <span className="text-[11px] text-ink-muted">Sex</span>
          <select
            value={profile.sex ?? ''}
            onChange={(event) =>
              void repo.saveProfile({
                sex: (event.target.value || null) as 'male' | 'female' | null,
              })
            }
            className="mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
          >
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-2 text-[12.5px] font-semibold">How active are you?</p>
        <ActivityPicker
          value={profile.activity}
          onChange={(activity) => void repo.saveProfile({ activity })}
        />
      </div>
    </Card>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <label>
      <span className="text-[11px] text-ink-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        // Keyed on the label so switching units re-mounts the field: `defaultValue` is read once,
        // so without this the box would keep showing centimetres under an "in" label.
        key={label}
        defaultValue={value ?? ''}
        onBlur={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        className="mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
      />
    </label>
  )
}
