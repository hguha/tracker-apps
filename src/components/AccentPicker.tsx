import { cn } from '@/lib/cn'
import {
  contrastRatio,
  ensureContrast,
  parseHex,
  toHex,
} from '@/lib/theme'

// Preset swatches plus a native color input, so the accent can be any hex — not
// just the built-in themes. Shared by Settings and onboarding.
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

export function AccentPicker({
  accentOverride,
  onChange,
  // Whether to show the "Theme default" reset chip (hidden where there's no theme concept).
  allowThemeDefault = true,
}: {
  accentOverride: string | null
  onChange: (accentOverride: string | null) => void
  allowThemeDefault?: boolean
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {allowThemeDefault && (
          <button
            onClick={() => onChange(null)}
            className={cn(
              'h-9 rounded-full border px-3 text-[13px] font-semibold',
              accentOverride === null
                ? 'border-accent bg-accent-wash text-accent'
                : 'border-line text-ink-secondary',
            )}
          >
            Theme default
          </button>
        )}
        {ACCENT_SWATCHES.map((hex) => (
          <button
            key={hex}
            onClick={() => onChange(hex)}
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
            onChange={(event) => onChange(event.target.value)}
            className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        </label>
      </div>

      {accentOverride && <AccentNotice hex={accentOverride} />}
    </div>
  )
}

// Explains the automatic contrast nudge when a chosen accent is too low-contrast
// against one of the surfaces (see applyAppearance / ensureContrast).
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
