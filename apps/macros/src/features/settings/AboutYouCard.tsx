import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@tracker-engine/ui'
import * as repo from '@/data/repository'

/**
 * Height, age and sex exist only to seed the very first target, before any week of data
 * qualifies. Once it does, they stop mattering — which is worth saying, since every other
 * tracker treats them as the answer rather than the guess.
 */
export function AboutYouCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  if (!profile) return null

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">About you</h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Only used for your starting target. After a week of weigh-ins and logs, the app
        measures your expenditure and stops guessing.
      </p>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <Field
          label="Height (cm)"
          value={profile.heightCm}
          onChange={(heightCm) => void repo.saveProfile({ heightCm })}
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
        defaultValue={value ?? ''}
        onBlur={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        className="mt-0.5 w-full rounded-xl bg-sunken px-2 py-2 text-[14px] outline-none"
      />
    </label>
  )
}
