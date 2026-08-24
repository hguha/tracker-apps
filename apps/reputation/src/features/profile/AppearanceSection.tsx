import { Card } from '@/components/Card'
import { AccentPicker } from '@/components/AccentPicker'
import { cn } from '@/lib/cn'
import { THEME_PRESETS, type ColorSchemePreference } from '@/lib/theme'
import { REGION_LABELS, REGIONS } from '@/domain/types'
import { regionVar } from '@/lib/palette'

const SCHEME_OPTIONS: { value: ColorSchemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function AppearanceSection({
  theme,
  colorScheme,
  accentOverride,
  onChange,
}: {
  theme: string
  colorScheme: ColorSchemePreference
  accentOverride: string | null
  onChange: (patch: {
    theme?: string
    colorScheme?: ColorSchemePreference
    accentOverride?: string | null
  }) => void
}) {
  return (
    <>
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Appearance</h2>

        <p className="mt-3 mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Light or dark
        </p>
        <div className="flex gap-1 rounded-lg bg-sunken p-0.5">
          {SCHEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onChange({ colorScheme: option.value })}
              className={cn(
                'h-9 flex-1 rounded-md text-[13.5px] font-semibold',
                colorScheme === option.value
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-ink-muted',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-4 mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Theme
        </p>
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((preset) => (
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
              <span
                className={cn(
                  'text-[14px] font-medium',
                  theme === preset.id && 'text-accent',
                )}
              >
                {preset.label}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-4 mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Accent color
        </p>
        <AccentPicker
          accentOverride={accentOverride}
          onChange={(next) => onChange({ accentOverride: next })}
        />
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Chart colors</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Body-part colors stay fixed across every theme, so a color always means the same
          body part and the charts stay readable for colorblind viewers.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-2">
          {REGIONS.map((region) => (
            <span key={region} className="flex items-center gap-1.5 text-[12.5px]">
              <span
                className="size-2.5 rounded-full"
                style={{ background: regionVar(region) }}
                aria-hidden
              />
              <span className="text-ink-secondary">{REGION_LABELS[region]}</span>
            </span>
          ))}
        </div>
      </Card>
    </>
  )
}
