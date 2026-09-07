import { useLiveQuery } from 'dexie-react-hooks'
import { AccentPicker, Card, PillSelect, Screen } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { THEME_PRESETS } from '@/lib/theme'
import type { ColorSchemePreference } from '@/domain/types'

const SCHEMES: { value: ColorSchemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function AppearanceScreen({ onBack }: { onBack: () => void }) {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  return (
    <Screen title="Appearance" onBack={onBack}>
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Colour scheme</h2>
        <div className="mt-2.5">
          <PillSelect
            value={profile?.colorScheme ?? 'system'}
            options={SCHEMES}
            // PillSelect allows a null selection; this control never should, so an empty choice
            // falls back to Auto rather than clearing the preference.
            onChange={(colorScheme) =>
              void repo.saveProfile({ colorScheme: colorScheme ?? 'system' })
            }
          />
        </div>

        <h2 className="mt-4 text-[15px] font-semibold tracking-tight">Theme</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => void repo.saveProfile({ theme: preset.id })}
              className={
                profile?.theme === preset.id
                  ? 'rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast'
                  : 'rounded-full bg-sunken px-3 py-1.5 text-[13px] text-ink-secondary'
              }
            >
              {preset.label}
            </button>
          ))}
        </div>

        <h2 className="mt-4 text-[15px] font-semibold tracking-tight">Accent</h2>
        <div className="mt-2">
          <AccentPicker
            accentOverride={profile?.accentOverride ?? null}
            onChange={(accentOverride) => void repo.saveProfile({ accentOverride })}
          />
        </div>
      </Card>
    </Screen>
  )
}
