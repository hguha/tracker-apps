// The demographics the coach personalizes against (§13): height, age, sex, and
// lifting experience. Lives on the Body screen next to measurements; all optional.

import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { PillSelect } from '@/components/PillSelect'
import { useDraftInput } from '@/lib/useDraftInput'
import { lengthFromCm, lengthToCm, parseNumber } from '@/lib/units'
import type { Profile } from '@/domain/types'

export function AboutYouCard({ profile }: { profile: Profile }) {
  const unit = profile.unitLength

  const height = useDraftInput({
    value: profile.heightCm === null ? '' : String(lengthFromCm(profile.heightCm, unit)),
    onCommit: (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return void repo.updateProfile({ heightCm: null })
      const parsed = parseNumber(trimmed)
      if (parsed !== null && parsed > 0) {
        void repo.updateProfile({ heightCm: lengthToCm(parsed, unit) })
      }
    },
  })

  const age = useDraftInput({
    value:
      profile.birthYear === null ? '' : String(new Date().getFullYear() - profile.birthYear),
    onCommit: (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return void repo.updateProfile({ birthYear: null })
      const parsed = parseNumber(trimmed)
      if (parsed !== null && parsed > 0 && parsed < 120) {
        void repo.updateProfile({ birthYear: new Date().getFullYear() - Math.round(parsed) })
      }
    },
  })

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">About you</h2>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        Lets the AI coach match strength standards and pace progression to you. All optional.
      </p>

      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="body-height" className="text-[13.5px] font-medium">
            Height
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="body-height"
              inputMode="decimal"
              placeholder="—"
              {...height.inputProps}
              className="h-10 w-24 rounded-lg border border-line bg-surface px-3 text-right text-[15px] outline-none focus:border-accent"
            />
            <span className="w-6 text-[13px] text-ink-muted">{unit}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="body-age" className="text-[13.5px] font-medium">
            Age
          </label>
          <input
            id="body-age"
            inputMode="numeric"
            placeholder="—"
            {...age.inputProps}
            className="h-10 w-24 rounded-lg border border-line bg-surface px-3 text-right text-[15px] outline-none focus:border-accent"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-[13.5px] font-medium">Sex</span>
          <PillSelect<'male' | 'female'>
            value={profile.sex}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
            ]}
            onChange={(sex) => void repo.updateProfile({ sex })}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-[13.5px] font-medium">Lifting experience</span>
          <PillSelect<'beginner' | 'intermediate' | 'advanced'>
            value={profile.experienceLevel}
            options={[
              { value: 'beginner', label: 'New' },
              { value: 'intermediate', label: 'Some' },
              { value: 'advanced', label: 'Lots' },
            ]}
            onChange={(experienceLevel) => void repo.updateProfile({ experienceLevel })}
          />
        </div>
      </div>
    </Card>
  )
}
