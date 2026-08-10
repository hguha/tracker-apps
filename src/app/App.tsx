/**
 * App shell and navigation.
 *
 * Deliberately a small hand-rolled view state rather than TanStack Router for
 * now: there are a handful of screens and no URL-shareable state yet. The spec's
 * routing table (§5.2) is the target once chart filters need to live in search
 * params — mapping these view names onto routes is mechanical.
 */

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
import { hasOnboarded, markOnboarded } from '@/db/owner'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { MeScreen } from '@/features/profile/MeScreen'
import { ExerciseLibraryScreen } from '@/features/library/ExerciseLibraryScreen'
import { ActiveWorkoutScreen } from '@/features/workout/ActiveWorkoutScreen'
import { StartWorkoutScreen } from '@/features/workout/StartWorkoutScreen'
import { TemplatesScreen } from '@/features/templates/TemplatesScreen'
import { TemplateEditorScreen } from '@/features/templates/TemplateEditorScreen'
import { applyAppearance, type ColorSchemePreference } from '@/lib/theme'
import { installAudioUnlock, setSoundEnabled } from '@/features/timer/sounds'
import { useSync } from '@/sync/useSync'

// The chart library is the biggest dependency in the app, so the logging path
// must never download it. Loaded only when the Insights tab is opened.
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
  | { kind: 'templateEditor'; templateId: string }
  | { kind: 'workout'; workoutId: string; isEditMode: boolean }

export function App() {
  // Audio must be unlocked by a real interaction, and iOS re-suspends it on
  // background. Installed at the root so cues work on every screen — an earlier
  // version only did this on the workout screen, which left the rest silent.
  useEffect(() => installAudioUnlock(), [])

  return (
    <AuthProviderScope>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProviderScope>
  )
}

/**
 * Decides between the sign-in screen and the app.
 *
 * A signed-out user gets the auth screen and nothing else — never a partially
 * populated shell (§11.1.3).
 */
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

  // Keyed on the user, so switching accounts remounts the tree and discards any
  // in-memory state belonging to the previous session.
  return <SignedInApp key={session.userId} />
}

function SignedInApp() {
  const { session } = useAuth()
  const [isReady, setIsReady] = useState(false)
  // First-run setup for a real account: collects the coach's inputs and uploads
  // anything logged on this device before signing in (§11.1.3). Local-only
  // accounts skip it — there's no account to upload to and nothing to prime.
  const [needsOnboarding, setNeedsOnboarding] = useState(
    () => session != null && !session.isLocal && !hasOnboarded(session.userId),
  )
  const [tab, setTab] = useState<TabKey>('home')
  const [view, setView] = useState<View>({ kind: 'tabs' })

  // Runs the outbox drain and delta pull on its own triggers when a backend is
  // attached; a no-op in the local-only prototype (§5.5).
  useSync()

  useEffect(() => {
    void seedIfNeeded().then(() => setIsReady(true))
  }, [])

  // Appearance and sound live in the profile, so they follow the same live-query
  // path as everything else and apply the moment they change.
  const appearance = useLiveQuery(async () => {
    if (!isReady) return undefined
    const profile = await repo.getProfile()
    return {
      theme: profile.theme,
      colorScheme: profile.colorScheme as ColorSchemePreference,
      accentOverride: profile.accentOverride,
      soundEnabled: profile.soundEnabled,
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

  // After seeding, so the profile the setup screen writes to exists.
  if (needsOnboarding && session) {
    return (
      <OnboardingScreen
        onDone={() => {
          markOnboarded(session.userId)
          setNeedsOnboarding(false)
        }}
      />
    )
  }

  /**
   * Resumes an unfinished session if one exists rather than starting a second.
   * Two concurrent workouts is never what the tap meant.
   */
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
