// App shell and navigation, as hand-rolled view state (§5.2) rather than a router
// while there's no URL-shareable state.

import { lazy, Suspense, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { seedIfNeeded } from '@/db/seed'
import * as repo from '@/data/repository'
import { AuthProviderScope, useAuth } from '@/auth/AuthContext'
import { ToastProvider } from '@/components/Toast'
import { TabBar, type TabKey } from './TabBar'
import { SignInScreen } from '@/features/auth/SignInScreen'
import { AccountScreen } from '@/features/auth/AccountScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { BadgesScreen } from '@/features/home/BadgesScreen'
import { CoachScreen } from '@/features/coach/CoachScreen'
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { MeScreen } from '@/features/profile/MeScreen'
import { SettingsScreen } from '@/features/profile/SettingsScreen'
import { BodyMetricsScreen } from '@/features/profile/BodyMetricsScreen'
import { DataScreen } from '@/features/profile/DataScreen'
import { ExerciseLibraryScreen } from '@/features/library/ExerciseLibraryScreen'
import { ActiveWorkoutScreen } from '@/features/workout/ActiveWorkoutScreen'
import { StartWorkoutScreen } from '@/features/workout/StartWorkoutScreen'
import { TemplatesScreen } from '@/features/templates/TemplatesScreen'
import { TemplateEditorScreen } from '@/features/templates/TemplateEditorScreen'
import { applyAppearance, type ColorSchemePreference } from '@/lib/theme'
import { installAudioUnlock, setSoundEnabled } from '@/features/timer/sounds'
import { useSync } from '@/sync/useSync'

// ECharts is the biggest dependency; lazy so the logging path never downloads it.
const InsightsScreen = lazy(() =>
  import('@/features/insights/InsightsScreen').then((m) => ({
    default: m.InsightsScreen,
  })),
)

type View =
  | { kind: 'tabs' }
  | { kind: 'start' }
  | { kind: 'account' }
  | { kind: 'connect' }
  | { kind: 'badges' }
  | { kind: 'coach' }
  | { kind: 'templates' }
  | { kind: 'settings' }
  | { kind: 'body' }
  | { kind: 'data' }
  | { kind: 'templateEditor'; templateId: string }
  | { kind: 'workout'; workoutId: string; isEditMode: boolean }

export function App() {
  // At the root so audio unlock covers every screen (iOS re-suspends on background).
  useEffect(() => installAudioUnlock(), [])

  return (
    <AuthProviderScope>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProviderScope>
  )
}

// A signed-out user gets the auth screen and nothing else (§11.1.3).
function AuthGate() {
  const { session, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        Loading…
      </div>
    )
  }

  if (!session) return <SignInScreen />

  // Keyed on the user, so switching accounts remounts and discards prior state.
  return <SignedInApp key={session.userId} />
}

function SignedInApp() {
  const { session } = useAuth()
  const [isReady, setIsReady] = useState(false)

  const [tab, setTab] = useState<TabKey>('home')
  const [view, setView] = useState<View>({ kind: 'tabs' })

  useSync()

  useEffect(() => {
    void seedIfNeeded().then(() => setIsReady(true))
  }, [])

  // Appearance and sound live in the profile, so they follow the same live-query
  // path as everything else and apply the moment they change. `onboardedAt` rides
  // along: it's on the profile so it syncs, which is what stops a second device
  // re-running setup (§11.1.3).
  const appearance = useLiveQuery(async () => {
    if (!isReady) return undefined
    const profile = await repo.getProfile()
    return {
      theme: profile.theme,
      colorScheme: profile.colorScheme as ColorSchemePreference,
      accentOverride: profile.accentOverride,
      soundEnabled: profile.soundEnabled,
      onboardedAt: profile.onboardedAt,
    }
  }, [isReady])

  useEffect(() => {
    if (!appearance) return
    applyAppearance(appearance)
    setSoundEnabled(appearance.soundEnabled)
  }, [appearance])

  // Re-apply on OS scheme change, which only matters while set to "Auto".
  useEffect(() => {
    if (!appearance || appearance.colorScheme !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyAppearance(appearance)
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [appearance])

  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        Setting up…
      </div>
    )
  }

  // Local-only accounts skip onboarding — nothing to upload or prime.
  if (
    session &&
    !session.isLocal &&
    appearance !== undefined &&
    appearance.onboardedAt === null
  ) {
    return (
      <OnboardingScreen
        onDone={() => void repo.updateProfile({ onboardedAt: Date.now() })}
      />
    )
  }

  // Resume an unfinished session rather than starting a second (§4.4).
  async function handleStartWorkout() {
    const active = await repo.getActiveWorkout()
    if (active) {
      setView({ kind: 'workout', workoutId: active.id, isEditMode: false })
      return
    }
    setView({ kind: 'start' })
  }

  if (view.kind === 'workout') {
    return (
      <ActiveWorkoutScreen
        workoutId={view.workoutId}
        isEditMode={view.isEditMode}
        onExit={() => setView({ kind: 'tabs' })}
      />
    )
  }

  if (view.kind === 'start') {
    return (
      <StartWorkoutScreen
        onStarted={(workoutId) =>
          setView({ kind: 'workout', workoutId, isEditMode: false })
        }
        onCancel={() => setView({ kind: 'tabs' })}
      />
    )
  }

  if (view.kind === 'account') {
    return (
      <AccountScreen
        onBack={() => setView({ kind: 'tabs' })}
        onConnectAccount={() => setView({ kind: 'connect' })}
      />
    )
  }

  // "Connect account": a signed-in device-only user upgrading to a real account.
  // On success the remote session arrives, the composite provider claims the
  // local data, and the tree remounts under the new uid (keyed on userId) —
  // which lands back on tabs automatically. Cancel returns here.
  if (view.kind === 'connect') {
    return <SignInScreen onCancel={() => setView({ kind: 'tabs' })} />
  }

  if (view.kind === 'badges') {
    return <BadgesScreen onBack={() => setView({ kind: 'tabs' })} />
  }

  if (view.kind === 'coach') {
    return (
      <CoachScreen
        onBack={() => setView({ kind: 'tabs' })}
        onOpenTemplates={() => setView({ kind: 'templates' })}
        onSignIn={() => setView({ kind: 'connect' })}
      />
    )
  }

  if (view.kind === 'settings') {
    return <SettingsScreen onBack={() => setView({ kind: 'tabs' })} />
  }

  if (view.kind === 'body') {
    return <BodyMetricsScreen onBack={() => setView({ kind: 'tabs' })} />
  }

  if (view.kind === 'data') {
    return <DataScreen onBack={() => setView({ kind: 'tabs' })} />
  }

  if (view.kind === 'templates') {
    return (
      <TemplatesScreen
        onEditTemplate={(templateId) => setView({ kind: 'templateEditor', templateId })}
        onStartWorkout={(workoutId) =>
          setView({ kind: 'workout', workoutId, isEditMode: false })
        }
        onBack={() => setView({ kind: 'tabs' })}
      />
    )
  }

  if (view.kind === 'templateEditor') {
    return (
      <TemplateEditorScreen
        templateId={view.templateId}
        onExit={() => setView({ kind: 'templates' })}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Bottom padding clears the raised center action, which overhangs the tab
          bar and would otherwise cover the last card. */}
      <main className="flex-1 overflow-y-auto pb-6 pt-safe">
        {tab === 'home' && (
          <HomeScreen
            onResumeWorkout={(workoutId) =>
              setView({ kind: 'workout', workoutId, isEditMode: false })
            }
            onStartWorkout={() => void handleStartWorkout()}
            onOpenWorkout={(workoutId) =>
              setView({ kind: 'workout', workoutId, isEditMode: true })
            }
            onOpenBadges={() => setView({ kind: 'badges' })}
            onOpenCoach={() => setView({ kind: 'coach' })}
          />
        )}
        {tab === 'history' && (
          <HistoryScreen
            onOpenWorkout={(workoutId) =>
              setView({ kind: 'workout', workoutId, isEditMode: true })
            }
            onStartedCopy={(workoutId) =>
              setView({ kind: 'workout', workoutId, isEditMode: false })
            }
          />
        )}
        {tab === 'library' && <ExerciseLibraryScreen />}
        {tab === 'insights' && (
          <Suspense fallback={<div className="p-6 text-ink-muted">Loading charts…</div>}>
            <InsightsScreen />
          </Suspense>
        )}
        {tab === 'me' && (
          <MeScreen
            onOpenLibrary={() => setTab('library')}
            onOpenTemplates={() => setView({ kind: 'templates' })}
            onOpenAccount={() => setView({ kind: 'account' })}
            onOpenCoach={() => setView({ kind: 'coach' })}
            onOpenBadges={() => setView({ kind: 'badges' })}
            onOpenSettings={() => setView({ kind: 'settings' })}
            onOpenBody={() => setView({ kind: 'body' })}
            onOpenData={() => setView({ kind: 'data' })}
          />
        )}
      </main>
      <TabBar
        active={tab}
        onSelect={setTab}
        onStartWorkout={() => void handleStartWorkout()}
      />
    </div>
  )
}
