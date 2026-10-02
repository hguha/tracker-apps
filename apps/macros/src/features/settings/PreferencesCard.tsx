import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, PillSelect } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import type { UnitSystem } from '@/domain/types'

const UNITS: { value: UnitSystem; label: string }[] = [
  { value: 'metric', label: 'kg / cm' },
  { value: 'imperial', label: 'lb / in' },
]

/**
 * Units, and the free-text preferences the coach reads.
 *
 * `dietNotes` is the single highest-value field for meal suggestions — "vegetarian", "no dairy",
 * "allergic to shellfish" — so it's stated as something the coach will actually use, not as a
 * decorative bio.
 */
export function PreferencesCard() {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const [notes, setNotes] = useState<string | null>(null)

  // Reset the draft when the stored value changes underneath (another device syncing).
  useEffect(() => {
    setNotes(null)
  }, [profile?.dietNotes])

  if (!profile) return null
  const value = notes ?? profile.dietNotes

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Preferences</h2>

      <div className="mt-2.5">
        <div className="text-[13px] font-medium">Units</div>
        <div className="mt-1.5">
          <PillSelect
            value={profile.units}
            options={UNITS}
            onChange={(units) => void repo.saveProfile({ units: units ?? 'metric' })}
          />
        </div>
      </div>

      <label className="mt-3 block">
        <span className="text-[13px] font-medium">Food preferences</span>
        <p className="text-[12px] text-ink-muted">
          Diets, allergies, foods you won&rsquo;t eat — the coach reads this.
        </p>
        <textarea
          rows={3}
          value={value}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== null && notes !== profile.dietNotes) {
              void repo.saveProfile({ dietNotes: notes.trim() })
            }
          }}
          placeholder="Vegetarian, no dairy, hate mushrooms"
          className="mt-1.5 w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[14px] outline-none"
        />
      </label>
    </Card>
  )
}
