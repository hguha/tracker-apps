import { useLiveQuery } from 'dexie-react-hooks'
import { PillSelect } from '@tracker-engine/ui'
import { SubScreen } from '@/components/SubScreen'
import * as repo from '@/data/repository'
import { THEME_PRESETS } from '@/lib/theme'
import { cn } from '@/lib/cn'
import type { ColorSchemePreference, ThemePreset } from '@/domain/types'

const SCHEMES: { value: ColorSchemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function AppearanceScreen({ onBack }: { onBack: () => void }) {
  const profile = useLiveQuery(() => repo.getProfile(), [])
  if (!profile) return null

  return (
    <SubScreen title="Appearance" onBack={onBack}>
      <section className="px-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Theme</h2>
        <div className="grid grid-cols-3 gap-3">
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              onClick={() => void repo.updateProfile({ theme: t.id as ThemePreset })}
              className={cn(
                'flex flex-col items-center gap-2 rounded-2xl border p-3',
                profile.theme === t.id ? 'border-accent bg-accent-wash' : 'border-line bg-surface',
              )}
            >
              <span className="size-8 rounded-full" style={{ backgroundColor: t.swatch }} />
              <span className="text-sm text-ink">{t.label}</span>
            </button>
          ))}
        </div>

        <h2 className="mb-2 mt-6 text-sm font-semibold text-ink-muted">Color scheme</h2>
        <PillSelect
          value={profile.colorScheme}
          options={SCHEMES}
          onChange={(v) => void repo.updateProfile({ colorScheme: v ?? 'system' })}
        />
      </section>
    </SubScreen>
  )
}
