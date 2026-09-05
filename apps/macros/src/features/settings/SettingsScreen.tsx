import { useLiveQuery } from 'dexie-react-hooks'
import { Card, useToast } from '@tracker-engine/ui'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'
import * as repo from '@/data/repository'
import { applyAppearance, THEME_PRESETS } from '@/lib/theme'
import { AboutYouCard } from './AboutYouCard'
import { ProgramCard } from './ProgramCard'

export function SettingsScreen() {
  const toast = useToast()
  const auth = useAuth()
  const sync = useSync()
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)

  return (
    <div className="space-y-3 px-3 py-3">
      <h1 className="px-1 text-[17px] font-semibold tracking-tight">Settings</h1>

      <ProgramCard />

      <AboutYouCard />

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Appearance</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                void repo.saveProfile({ theme: preset.id }).then(() =>
                  applyAppearance({
                    theme: preset.id,
                    colorScheme: profile?.colorScheme ?? 'system',
                  }),
                )
              }}
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
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Data &amp; sync</h2>
        <dl className="mt-2 space-y-1.5 text-[13.5px]">
          <Row label="Sync">
            {sync.enabled ? 'On — syncs to your account' : 'This device only'}
          </Row>
          <Row label="Queued">{String(sync.pending)}</Row>
          {sync.deadLettered > 0 && <Row label="Failed">{String(sync.deadLettered)}</Row>}
        </dl>
        {!sync.enabled && (
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Everything stays in this browser. Nothing is uploaded.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Connect REPutation</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Not built yet. It will read training days and bodyweight to sharpen your targets —
          and deliberately won't add "calories burned" to your budget, because a measured
          expenditure already includes training.
        </p>
      </Card>

      {auth.session && (
        <Card className="p-4">
          <button
            onClick={() => void auth.signOut().then(() => toast.show('Signed out'))}
            className="text-[14px] font-semibold text-accent active:opacity-60"
          >
            Sign out
          </button>
        </Card>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="tabular font-semibold">{children}</dd>
    </div>
  )
}
