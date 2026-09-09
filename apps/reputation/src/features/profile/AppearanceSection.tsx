import { AppearanceCard, Card } from '@tracker-engine/ui'
import { THEME_PRESETS, type ColorSchemePreference } from '@/lib/theme'
import { REGION_LABELS, REGIONS } from '@/domain/types'
import { regionVar } from '@/lib/palette'

/** The shared appearance control, plus the fixed body-part legend that is REPutation's alone. */
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
      <AppearanceCard
        themes={THEME_PRESETS}
        theme={theme}
        colorScheme={colorScheme}
        accentOverride={accentOverride}
        onChange={onChange}
      />

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
