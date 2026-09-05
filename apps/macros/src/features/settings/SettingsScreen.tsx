import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight } from 'lucide-react'
import { AccentPicker, Card, PillSelect } from '@tracker-engine/ui'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import * as repo from '@/data/repository'
import { THEME_PRESETS } from '@/lib/theme'
import type { ColorSchemePreference } from '@/domain/types'
import { AboutYouCard } from './AboutYouCard'
import { ProgramCard } from './ProgramCard'

const SCHEMES: { value: ColorSchemePreference; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function SettingsScreen({
  onConnect,
  onOpenAccount,
  onOpenData,
}: {
  onConnect: () => void
  onOpenAccount: () => void
  onOpenData: () => void
}) {
  const { session } = useAuth()
  const sync = useSync()
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">Settings</h1>

      <ProgramCard />
      <AboutYouCard />

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Appearance</h2>

        <div className="mt-2.5">
          <PillSelect
            value={profile?.colorScheme ?? 'system'}
            options={SCHEMES}
            // PillSelect allows a null selection; this control never should, so an empty
            // choice falls back to Auto rather than clearing the preference.
            onChange={(colorScheme) =>
              void repo.saveProfile({ colorScheme: colorScheme ?? 'system' })
            }
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
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

        <div className="mt-3">
          <AccentPicker
            accentOverride={profile?.accentOverride ?? null}
            onChange={(accentOverride) => void repo.saveProfile({ accentOverride })}
          />
        </div>
      </Card>

      <Card className="p-0">
        <NavRow label="Account" detail={session?.email ?? 'This device only'} onClick={onOpenAccount} />
        <NavRow
          label="Data & sync"
          detail={sync.enabled ? 'Syncing' : 'This device only'}
          onClick={onOpenData}
        />
      </Card>

      {!sync.enabled && (
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Sync across devices</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Everything you have logged here moves onto the account — nothing is replaced.
          </p>
          <button
            onClick={onConnect}
            className="mt-2 w-full rounded-xl bg-sunken py-2.5 text-[14px] font-semibold text-accent active:opacity-60"
          >
            Connect an account
          </button>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Connect REPutation</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Not built yet. It will read training days and bodyweight to sharpen your targets —
          and deliberately won&rsquo;t add &ldquo;calories burned&rdquo; to your budget, because a
          measured expenditure already includes training.
        </p>
      </Card>
    </div>
  )
}

function NavRow({
  label,
  detail,
  onClick,
}: {
  label: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 active:bg-sunken"
    >
      <span className="flex-1 text-[14.5px] font-medium">{label}</span>
      <span className="truncate text-[13px] text-ink-muted">{detail}</span>
      <ChevronRight size={18} className="shrink-0 text-ink-muted" />
    </button>
  )
}
