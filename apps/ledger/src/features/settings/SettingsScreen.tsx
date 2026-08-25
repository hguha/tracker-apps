// Settings hub with hand-rolled sub-navigation (matching the app's view-state style).
// Owns account identity + sign-out; delegates appearance, categories, accounts, and
// data to focused sub-screens.

import { useState } from 'react'
import { ChevronRight, CreditCard, Database, Palette, Tag } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button } from '@tracker-engine/ui'
import { initialsOf } from '@tracker-engine/auth'
import { useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'
import { ScreenHeader } from '@/components/ScreenHeader'
import type { SyncStatus } from '@/sync/useSync'
import { AppearanceScreen } from './AppearanceScreen'
import { CategoriesScreen } from './CategoriesScreen'
import { AccountsScreen } from './AccountsScreen'
import { DataScreen } from './DataScreen'

type Sub = 'root' | 'appearance' | 'categories' | 'accounts' | 'data'

export function SettingsScreen({ sync }: { sync: SyncStatus }) {
  const [sub, setSub] = useState<Sub>('root')
  const { session, signOut } = useAuth()
  const profile = useLiveQuery(() => repo.getProfile(), [])

  if (sub === 'appearance') return <AppearanceScreen onBack={() => setSub('root')} />
  if (sub === 'categories') return <CategoriesScreen onBack={() => setSub('root')} />
  if (sub === 'accounts') return <AccountsScreen onBack={() => setSub('root')} />
  if (sub === 'data') return <DataScreen sync={sync} onBack={() => setSub('root')} />

  const name = profile?.displayName ?? session?.displayName ?? 'You'

  return (
    <div className="pb-6">
      <ScreenHeader title="Settings" />

      <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-lg font-semibold text-accent-contrast">
          {initialsOf(name)}
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-ink">{name}</div>
          <div className="truncate text-sm text-ink-muted">
            {session?.isLocal ? 'On this device only' : session?.email}
          </div>
        </div>
      </div>

      <div className="mx-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        <Row icon={<CreditCard size={18} />} label="Bank accounts" onClick={() => setSub('accounts')} />
        <Row icon={<Tag size={18} />} label="Categories & budgets" onClick={() => setSub('categories')} />
        <Row icon={<Palette size={18} />} label="Appearance" onClick={() => setSub('appearance')} />
        <Row icon={<Database size={18} />} label="Sync & data" onClick={() => setSub('data')} />
      </div>

      <div className="mt-6 px-4">
        <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
          {session?.isLocal ? 'Leave this device book' : 'Sign out'}
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-ink-muted">
        COINcidence · runs on the shared @tracker-engine
      </p>
    </div>
  )
}

function Row({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken"
    >
      <span className="text-ink-muted">{icon}</span>
      <span className="flex-1 text-ink">{label}</span>
      <ChevronRight size={18} className="text-ink-muted" />
    </button>
  )
}
