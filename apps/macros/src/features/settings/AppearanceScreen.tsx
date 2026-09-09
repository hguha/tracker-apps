import { useLiveQuery } from 'dexie-react-hooks'
import { AppearanceCard, Card, Screen } from '@tracker-engine/ui'
import * as repo from '@/data/repository'
import { THEME_PRESETS } from '@/lib/theme'
import type { ColorSchemePreference, ThemePreset } from '@/domain/types'

export function AppearanceScreen({ onBack }: { onBack: () => void }) {
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  return (
    <Screen title="Appearance" onBack={onBack}>
      <AppearanceCard
        themes={THEME_PRESETS}
        theme={profile?.theme ?? 'default'}
        colorScheme={profile?.colorScheme ?? 'system'}
        accentOverride={profile?.accentOverride ?? null}
        onChange={(patch) =>
          void repo.saveProfile({
            ...(patch.theme !== undefined && { theme: patch.theme as ThemePreset }),
            ...(patch.colorScheme !== undefined && {
              colorScheme: patch.colorScheme as ColorSchemePreference,
            }),
            ...(patch.accentOverride !== undefined && { accentOverride: patch.accentOverride }),
          })
        }
      />

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Chart colours</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Protein, carbs and fat keep the same colour in every theme, so a colour always means
          the same macro.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-2">
          {[
            ['Protein', 'var(--macro-protein)'],
            ['Carbs', 'var(--macro-carbs)'],
            ['Fat', 'var(--macro-fat)'],
            ['Fibre', 'var(--macro-fiber)'],
          ].map(([label, color]) => (
            <span key={label} className="flex items-center gap-1.5 text-[12.5px]">
              <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
              <span className="text-ink-secondary">{label}</span>
            </span>
          ))}
        </div>
      </Card>
    </Screen>
  )
}
