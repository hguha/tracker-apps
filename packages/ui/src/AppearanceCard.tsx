import { cn } from '@tracker-engine/core'
import { AccentPicker } from './AccentPicker'
import { Card } from './Card'
import { SectionLabel } from './SectionLabel'
import type { ColorSchemePreference, ThemePreset } from './appearance'

const SCHEMES: { value: ColorSchemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * Light/dark, theme preset and accent — one control for all three, shared by every app.
 *
 * The presets themselves stay per app (they're that app's design tokens); what's shared is the
 * shape of the choice, which had already drifted: two apps with the same settings offering them
 * as pills in one and swatch tiles in the other, for no reason a user could name.
 */
export function AppearanceCard({
  themes,
  theme,
  colorScheme,
  accentOverride,
  onChange,
  children,
}: {
  themes: readonly ThemePreset[]
  theme: string
  colorScheme: ColorSchemePreference
  accentOverride: string | null
  onChange: (patch: {
    theme?: string
    colorScheme?: ColorSchemePreference
    accentOverride?: string | null
  }) => void
  /** Anything app-specific to append, e.g. a fixed chart-colour legend. */
  children?: React.ReactNode
}) {
  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Appearance</h2>

      <SectionLabel className="mb-1.5 mt-3">Light or dark</SectionLabel>
      <div className="flex gap-1 rounded-lg bg-sunken p-0.5">
        {SCHEMES.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange({ colorScheme: option.value })}
            className={cn(
              'h-9 flex-1 rounded-md text-[13.5px] font-semibold',
              colorScheme === option.value ? 'bg-accent-wash text-accent shadow-sm' : 'text-ink-muted',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <SectionLabel className="mb-2 mt-4">Theme</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {themes.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onChange({ theme: preset.id })}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left',
              theme === preset.id ? 'border-accent bg-accent-wash' : 'border-line',
            )}
          >
            <span
              className="size-5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
              style={{ background: preset.swatch }}
              aria-hidden
            />
            <span className={cn('text-[14px] font-medium', theme === preset.id && 'text-accent')}>
              {preset.label}
            </span>
          </button>
        ))}
      </div>

      <SectionLabel className="mb-2 mt-4">Accent color</SectionLabel>
      <AccentPicker
        accentOverride={accentOverride}
        onChange={(next) => onChange({ accentOverride: next })}
      />

      {children}
    </Card>
  )
}
