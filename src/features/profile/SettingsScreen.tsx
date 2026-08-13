// Preferences: units, logging, coaching inputs, appearance.

import { useState } from 'react'
import { ChevronLeft, Compass, Sparkles, Volume2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { Card } from '@/components/Card'
import { cn } from '@/lib/cn'
import { useDraftInput } from '@/lib/useDraftInput'
import { playCue, setSoundEnabled, unlockAudio } from '@/features/timer/sounds'
import { AppTour } from '@/features/onboarding/AppTour'
import { AppearanceSection } from './AppearanceSection'
import { lengthFromCm, lengthToCm, parseNumber } from '@/lib/units'
import type { DistanceUnit, LengthUnit, Profile, WeightUnit } from '@/domain/types'

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const profile = useLiveQuery(() => repo.getProfile(), [])
  const [showTour, setShowTour] = useState(false)

  if (!profile) return <div className="p-6 text-ink-muted">Loading…</div>

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Units</h2>
          <div className="mt-3 space-y-3">
            <UnitToggle<WeightUnit>
              label="Weight"
              value={profile.unitWeight}
              options={['lb', 'kg']}
              onChange={(unitWeight) => void repo.updateProfile({ unitWeight })}
            />
            <UnitToggle<DistanceUnit>
              label="Distance"
              value={profile.unitDistance}
              options={['mi', 'km']}
              onChange={(unitDistance) => void repo.updateProfile({ unitDistance })}
            />
            <UnitToggle<LengthUnit>
              label="Length"
              value={profile.unitLength}
              options={['in', 'cm']}
              onChange={(unitLength) => void repo.updateProfile({ unitLength })}
            />
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Logging</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-[13.5px] font-medium">Default rest timer</label>
              <div className="mt-1.5 flex gap-1.5">
                {[30, 60, 90, 120, 180].map((seconds) => (
                  <button
                    key={seconds}
                    onClick={() =>
                      void repo.updateProfile({ defaultRestSeconds: seconds })
                    }
                    className={cn(
                      'h-10 flex-1 rounded-lg text-[13px] font-semibold',
                      profile.defaultRestSeconds === seconds
                        ? 'bg-accent text-accent-contrast'
                        : 'bg-sunken text-ink-secondary',
                    )}
                  >
                    {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[13.5px] font-medium">Weekly workout goal</label>
              <p className="text-[12px] text-ink-muted">
                The target the Home ring fills toward.
              </p>
              <div className="mt-1.5 flex gap-1.5">
                {[2, 3, 4, 5, 6].map((count) => (
                  <button
                    key={count}
                    onClick={() => void repo.updateProfile({ weeklyWorkoutGoal: count })}
                    className={cn(
                      'h-10 flex-1 rounded-lg text-[13px] font-semibold',
                      profile.weeklyWorkoutGoal === count
                        ? 'bg-accent text-accent-contrast'
                        : 'bg-sunken text-ink-secondary',
                    )}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            <ToggleRow
              label="Track RPE"
              hint="Rate of Perceived Exertion — how hard each set felt, 1–10"
              checked={profile.showRpe}
              onChange={(showRpe) => void repo.updateProfile({ showRpe })}
            />

            <ToggleRow
              label="Start rest automatically"
              hint="Begin the timer as soon as you log a set"
              checked={profile.autoStartRest}
              onChange={(autoStartRest) => void repo.updateProfile({ autoStartRest })}
            />

            <ToggleRow
              label="Sounds"
              hint="Cues for logging a set, records, and rest"
              checked={profile.soundEnabled}
              onChange={(soundEnabled) => {
                setSoundEnabled(soundEnabled)
                void repo.updateProfile({ soundEnabled })
                // Play the cue being enabled, so the choice is audible.
                if (soundEnabled) playCue('pr')
              }}
            />

            {/* On iPhone the ringer switch silences web audio outright, and nothing
                reports it — so give people a button that proves whether it works. */}
            {profile.soundEnabled && (
              <div className="-mt-1">
                <button
                  onClick={() => {
                    unlockAudio()
                    playCue('rest-complete')
                  }}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold text-accent active:bg-accent-wash"
                >
                  <Volume2 size={15} />
                  Test sound
                </button>
                <p className="mt-1.5 text-[12px] text-ink-muted">
                  Hear nothing on iPhone? Check the ring/silent switch — it mutes web
                  audio even at full volume.
                </p>
              </div>
            )}

            <ToggleRow
              label="Training avatar"
              hint="A body on Home that buffs up and deflates with your training"
              checked={profile.showAvatar}
              onChange={(showAvatar) => void repo.updateProfile({ showAvatar })}
            />
          </div>
        </Card>

        <CoachingCard profile={profile} />

        <AppearanceSection
          theme={profile.theme}
          colorScheme={profile.colorScheme}
          accentOverride={profile.accentOverride}
          onChange={(patch) => void repo.updateProfile(patch)}
        />

        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Getting started</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Nothing you've logged is affected.
          </p>
          <button
            onClick={() => setShowTour(true)}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line text-[14px] font-semibold text-accent active:bg-accent-wash"
          >
            <Compass size={16} />
            App walkthrough
          </button>
          <button
            onClick={() => void repo.updateProfile({ onboardingVersion: 0 })}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line text-[14px] font-semibold text-accent active:bg-accent-wash"
          >
            <Sparkles size={16} />
            Replay setup
          </button>
        </Card>

        <div className="h-4" />
      </div>

      {showTour && <AppTour onClose={() => setShowTour(false)} />}
    </div>
  )
}

// Height + goal, the profile fields the coach personalizes against (§13).
function CoachingCard({ profile }: { profile: Profile }) {
  const unit = profile.unitLength
  const heightValue =
    profile.heightCm === null ? '' : String(lengthFromCm(profile.heightCm, unit))

  const height = useDraftInput({
    value: heightValue,
    onCommit: (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return void repo.updateProfile({ heightCm: null })
      const parsed = parseNumber(trimmed)
      if (parsed !== null && parsed > 0) {
        void repo.updateProfile({ heightCm: lengthToCm(parsed, unit) })
      }
    },
  })

  const goal = useDraftInput({
    value: profile.trainingGoal ?? '',
    onCommit: (draft) => void repo.updateProfile({ trainingGoal: draft.trim() }),
  })

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
        <Sparkles size={15} className="text-accent" />
        Coaching
      </h2>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        Helps the AI coach tailor advice. Shared with the coach only — you can see exactly
        what's sent from the coach screen.
      </p>

      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="me-height" className="text-[13.5px] font-medium">
            Height
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="me-height"
              inputMode="decimal"
              placeholder="—"
              {...height.inputProps}
              className="h-10 w-24 rounded-lg border border-line bg-surface px-3 text-right text-[15px] outline-none focus:border-accent"
            />
            <span className="w-6 text-[13px] text-ink-muted">{unit}</span>
          </div>
        </div>

        <div>
          <label htmlFor="me-goal" className="text-[13.5px] font-medium">
            Training goal
          </label>
          <input
            id="me-goal"
            placeholder='e.g. "gain strength", "lean out for summer"'
            {...goal.inputProps}
            className="mt-1.5 h-10 w-full rounded-lg border border-line bg-surface px-3 text-[15px] outline-none focus:border-accent"
          />
        </div>
      </div>
    </Card>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="block text-[13.5px] font-medium">{label}</span>
        <span className="block text-[12px] text-ink-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-[var(--accent)]"
      />
    </label>
  )
}

function UnitToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: T[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13.5px] font-medium">{label}</span>
      <div className="flex gap-1 rounded-lg bg-sunken p-0.5">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={cn(
              'h-8 rounded-md px-3.5 text-[13px] font-semibold',
              value === option ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
