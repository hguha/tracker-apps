import { Card } from '@/components/Card'
import { cn } from '@/lib/cn'
import {
  THEME_PRESETS,
  contrastRatio,
  ensureContrast,
  parseHex,
  toHex,
  type ColorSchemePreference,
} from '@/lib/theme'
import { REGION_LABELS, REGIONS } from '@/domain/types'
import { regionVar } from '@/lib/palette'

const ACCENT_SWATCHES = [
  '#2a78d6',
  '#4f46c9',
  '#7a3fbd',
  '#b0247e',
  '#c1291f',
  '#c1521b',
  '#a8790d',
  '#1f7a47',
  '#0f7a86',
  '#3d4654',
]

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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onChange({ accentOverride: null })}
            className={cn(
              'h-9 rounded-full border px-3 text-[13px] font-semibold',
              accentOverride === null
                ? 'border-accent bg-accent-wash text-accent'
                : 'border-line text-ink-secondary',
            )}
          >
            Theme default
          </button>
          {ACCENT_SWATCHES.map((hex) => (
            <button
              key={hex}
              onClick={() => onChange({ accentOverride: hex })}
              aria-label={`Accent ${hex}`}
              className={cn(
                'size-9 rounded-full ring-1 ring-inset ring-black/10',
                accentOverride?.toLowerCase() === hex.toLowerCase() &&
                  'ring-2 ring-offset-2 ring-offset-[var(--surface-1)]',
              )}
              style={{
                background: hex,
                ...(accentOverride?.toLowerCase() === hex.toLowerCase()
                  ? { ['--tw-ring-color' as string]: hex }
                  : {}),
              }}
            />
          ))}
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-[13px] font-semibold text-ink-secondary">
            Custom
            <input
              type="color"
              value={accentOverride ?? '#2a78d6'}
              onChange={(event) => onChange({ accentOverride: event.target.value })}
              className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>
        </div>

        {accentOverride && <AccentNotice hex={accentOverride} />}
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

function AccentNotice({ hex }: { hex: string }) {
  const rgb = parseHex(hex)
  if (!rgb) return null

  const lightSurface = { r: 252, g: 252, b: 251 }
  const darkSurface = { r: 26, g: 26, b: 25 }

  const lightAdjusted = toHex(ensureContrast(rgb, lightSurface))
  const darkAdjusted = toHex(ensureContrast(rgb, darkSurface))
  const wasAdjusted =
    lightAdjusted.toLowerCase() !== hex.toLowerCase() ||
    darkAdjusted.toLowerCase() !== hex.toLowerCase()

  if (!wasAdjusted) return null

  const ratio = Math.min(
    contrastRatio(rgb, lightSurface),
    contrastRatio(rgb, darkSurface),
  )

  return (
    <p className="mt-2.5 text-[12px] text-ink-muted">
      This color measures {ratio.toFixed(1)}:1 against one of the backgrounds, below the
      3:1 minimum, so it's darkened or lightened slightly where needed to stay legible.
    </p>
  )
}
