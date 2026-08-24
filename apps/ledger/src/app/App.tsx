// App shell and navigation, as hand-rolled view state (matching REPutation) rather
// than a router while there's no URL-shareable state.

import { lazy, Suspense, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { AuthProviderScope, useAuth } from '@/auth/AuthContext'
import { ToastProvider } from '@tracker-engine/ui'
import { applyAppearance } from '@/lib/theme'
import { useColorScheme } from '@/lib/useColorScheme'
import { useSync } from '@/sync/useSync'
import type { ColorSchemePreference } from '@/domain/types'
import { TabBar, type TabKey } from './TabBar'
import { SignInScreen } from '@/features/auth/SignInScreen'
import { OverviewScreen } from '@/features/overview/OverviewScreen'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { LogScreen } from '@/features/log/LogScreen'
import { CoachScreen } from '@/features/coach/CoachScreen'

// ECharts is the biggest dependency; lazy so the logging path never downloads it.
const InsightsScreen = lazy(() =>
  import('@/features/insights/InsightsScreen').then((m) => ({ default: m.InsightsScreen })),
)

type View =
  | { kind: 'tabs' }
  | { kind: 'log' }
  | { kind: 'editEntry'; entryId: string }
  | { kind: 'coach' }

export function App() {
  return (
    <AuthProviderScope>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProviderScope>
  )
}

function AuthGate() {
  const { session, isLoading } = useAuth()

  if (isLoading) {
    return <Centered>Loading…</Centered>
  }
  if (!session) return <SignInScreen />

  // Keyed on the user, so switching accounts remounts and discards prior state.
  return <SignedInApp key={session.userId} />
}

function SignedInApp() {
  const [isReady, setIsReady] = useState(false)
  const [tab, setTab] = useState<TabKey>('overview')
  const [view, setView] = useState<View>({ kind: 'tabs' })

  // One engine for the whole app; Settings' data controls read this same status.
  const sync = useSync()

  useEffect(() => {
    void repo.seedIfNeeded().then(() => setIsReady(true))
  }, [])

  // Appearance lives on the profile, so it syncs across devices and applies the
  // moment it changes — the same live-query path as everything else.
  const appearance = useLiveQuery(async () => {
    if (!isReady) return undefined
    const profile = await repo.getProfile()
    return {
      theme: profile?.theme ?? 'default',
      colorScheme: (profile?.colorScheme ?? 'system') as ColorSchemePreference,
    }
  }, [isReady])

  const osScheme = useColorScheme()
  useEffect(() => {
    if (appearance) applyAppearance(appearance)
  }, [appearance, osScheme])

  if (!isReady) return <Centered>Setting up…</Centered>

  if (view.kind === 'log' || view.kind === 'editEntry') {
    return (
      <LogScreen
        entryId={view.kind === 'editEntry' ? view.entryId : undefined}
        onClose={() => setView({ kind: 'tabs' })}
      />
    )
  }

  if (view.kind === 'coach') {
    return <CoachScreen onClose={() => setView({ kind: 'tabs' })} />
  }

  const openEntry = (entryId: string) => setView({ kind: 'editEntry', entryId })
  const openCoach = () => setView({ kind: 'coach' })

  return (
    <div className="flex h-full flex-col bg-page">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && <OverviewScreen onOpenEntry={openEntry} onOpenCoach={openCoach} />}
        {tab === 'history' && <HistoryScreen onOpenEntry={openEntry} />}
        {tab === 'insights' && (
          <Suspense fallback={<Centered>Loading insights…</Centered>}>
            <InsightsScreen onOpenCoach={openCoach} />
          </Suspense>
        )}
        {tab === 'settings' && <SettingsScreen sync={sync} />}
      </div>
      <TabBar active={tab} onSelect={setTab} onLog={() => setView({ kind: 'log' })} />
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-ink-muted">{children}</div>
}
