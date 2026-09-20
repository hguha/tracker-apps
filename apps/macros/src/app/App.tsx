import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey } from '@tracker-engine/core'
import { ToastProvider, useColorScheme } from '@tracker-engine/ui'
import { applyStatusBarStyle } from '@tracker-engine/platform'
import { AuthProviderScope, useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { syncReminders } from '@/data/reminders'
import { syncHealthWeightsIfEnabled } from '@/data/health'
import { applyAppearance } from '@/lib/theme'
import { useSync } from '@/sync/useSync'
import { TabBar, type TabKey } from './TabBar'
import { SignInScreen } from '@/features/auth/SignInScreen'
import { SetPasswordScreen } from '@/features/auth/SetPasswordScreen'
import { AccountScreen } from '@/features/auth/AccountScreen'
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen'
import { TodayScreen } from '@/features/today/TodayScreen'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { InsightsScreen } from '@/features/insights/InsightsScreen'
import { SettingsScreen, type SettingsRoute } from '@/features/settings/SettingsScreen'
import { DataScreen } from '@/features/settings/DataScreen'
import { TargetsScreen } from '@/features/settings/TargetsScreen'
import { AboutYouScreen } from '@/features/settings/AboutYouScreen'
import { PreferencesScreen } from '@/features/settings/PreferencesScreen'
import { RemindersScreen } from '@/features/settings/RemindersScreen'
import { AppearanceScreen } from '@/features/settings/AppearanceScreen'
import { BadgesScreen } from '@/features/badges/BadgesScreen'
import { LibraryScreen } from '@/features/library/LibraryScreen'
import { CheckInScreen } from '@/features/checkin/CheckInScreen'
import { CoachScreen } from '@/features/coach/CoachScreen'
import { LogScreen } from '@/features/log/LogScreen'
import { DayScreen } from '@/features/day/DayScreen'
import { mealForHour } from '@/lib/meals'
import { ONBOARDING_VERSION, type MealSlot } from '@/domain/types'

type View =
  | { kind: 'tabs' }
  | { kind: 'log'; meal: MealSlot; day?: string; back?: View }
  | { kind: 'day'; day: string }
  | { kind: 'settings'; route: SettingsRoute; recipeId?: string }
  | { kind: 'connect' }

export function App() {
  return (
    <AuthProviderScope>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProviderScope>
  )
}

// A signed-out user gets the auth screen and nothing else.
function AuthGate() {
  const { session, isLoading, isRecoveringPassword } = useAuth()

  // A reset code signs the user in, so this has to win over the normal app — otherwise
  // arriving from "reset my password" just opens Today with the old password still set.
  if (isRecoveringPassword) return <SetPasswordScreen />
  if (isLoading) return <Splash>Loading…</Splash>
  if (!session) return <SignInScreen />
  // Keyed on the user, so connecting an account remounts and drops the screen state that
  // belonged to the old owner — including the "connect an account" view itself, which would
  // otherwise stay on screen after the sign-in it just completed.
  return <SignedInApp key={session.userId} />
}

function SignedInApp() {
  const [isReady, setIsReady] = useState(false)
  const [tab, setTab] = useState<TabKey>('today')
  const [view, setView] = useState<View>({ kind: 'tabs' })

  useSync()

  // Writes belong in an effect, not a live query: Dexie refuses a readwrite transaction inside
  // a liveQuery context, and a querier that writes would also re-fire on its own writes.
  useEffect(() => {
    void seedFoods()
      .then(() => repo.ensureProfile())
      // Before the check-in: an imported weigh-in is part of the week it measures.
      .then(() => syncHealthWeightsIfEnabled())
      .then(() => repo.runCheckIn())
      .then(() => setIsReady(true))
      .catch(() => setIsReady(true))
  }, [])

  /**
   * Reminders are recomputed rather than repeated.
   *
   * A daily repeat rule would nag someone who logged lunch two hours ago, so what's scheduled is
   * derived from what today still lacks — which means it has to be re-derived whenever that changes.
   * Keyed on the day's entries, so every log, edit and delete re-runs it, and on `isReady` so the
   * first run happens after the profile exists. See `data/reminders`.
   */
  const todaysProgress = useLiveQuery(
    async () => {
      if (!isReady) return ''
      const day = dayKey(Date.now())
      const entries = await repo.entriesForDay(day)
      // The weigh-in nudge is conditional on there being no weigh-in today, so recording one has to
      // re-derive the schedule exactly as logging a meal does.
      const weighed = (await repo.weights()).some((row) => row.day === day)
      return `${entries.length}|${weighed}`
    },
    [isReady],
    '',
  )
  useEffect(() => {
    if (!isReady) return
    void syncReminders()
  }, [isReady, todaysProgress])

  // Appearance lives on the profile, so it follows the same live-query path as everything else
  // and applies the moment it changes — including on another device. `onboardingVersion` rides
  // along: it's synced, which is what stops a second device re-running setup.
  const appearance = useLiveQuery(async () => {
    if (!isReady) return undefined
    const profile = await repo.getProfile()
    return {
      theme: profile.theme,
      colorScheme: profile.colorScheme,
      accentOverride: profile.accentOverride,
      onboardingVersion: profile.onboardingVersion,
    }
  }, [isReady])

  // The live OS scheme, via the shared hook, so "Auto" re-applies on a light/dark switch.
  const osScheme = useColorScheme()
  useEffect(() => {
    if (!appearance) return
    const scheme = applyAppearance(appearance)
    if (scheme) applyStatusBarStyle(scheme)
  }, [appearance, osScheme])

  if (!isReady || appearance === undefined) return <Splash>Setting up…</Splash>

  if (appearance.onboardingVersion < ONBOARDING_VERSION) {
    return <OnboardingScreen onDone={() => setView({ kind: 'tabs' })} />
  }

  const toTabs = () => setView({ kind: 'tabs' })

  if (view.kind === 'connect') return <SignInScreen onCancel={toTabs} />
  if (view.kind === 'log') {
    // Back goes where you came from: adding to Tuesday from the day screen returns to Tuesday,
    // not to the tab bar, which would lose the place the user was working in.
    const back = view.back ?? { kind: 'tabs' as const }
    return (
      <LogScreen meal={view.meal} day={view.day} onClose={() => setView(back)} />
    )
  }
  if (view.kind === 'day') {
    return (
      <DayScreen
        day={view.day}
        onClose={toTabs}
        onAdd={(day, meal) =>
          setView({ kind: 'log', meal, day, back: { kind: 'day', day } })
        }
      />
    )
  }
  if (view.kind === 'settings') {
    switch (view.route) {
      case 'targets':
        return <TargetsScreen onBack={toTabs} />
      case 'about':
        return <AboutYouScreen onBack={toTabs} />
      case 'preferences':
        return <PreferencesScreen onBack={toTabs} />
      case 'reminders':
        return <RemindersScreen onBack={toTabs} />
      case 'appearance':
        return <AppearanceScreen onBack={toTabs} />
      case 'badges':
        return <BadgesScreen onBack={toTabs} />
      case 'library':
        return <LibraryScreen initialRecipeId={view.recipeId ?? null} onBack={toTabs} />
      case 'meals':
        return <LibraryScreen initialTab="meals" onBack={toTabs} />
      case 'foods':
        return <LibraryScreen initialTab="foods" onBack={toTabs} />
      case 'checkin':
        return <CheckInScreen onBack={toTabs} />
      case 'coach':
        return <CoachScreen onBack={toTabs} />
      case 'data':
        return <DataScreen onBack={toTabs} />
      case 'account':
        return (
          <AccountScreen onBack={toTabs} onConnect={() => setView({ kind: 'connect' })} />
        )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto pb-6 pt-safe">
        {tab === 'today' && (
          <TodayScreen
            onOpenDay={(day) => setView({ kind: 'day', day })}
            onOpenTargets={() => setView({ kind: 'settings', route: 'targets' })}
            onOpenCoach={() => setView({ kind: 'settings', route: 'coach' })}
            onOpenAbout={() => setView({ kind: 'settings', route: 'about' })}
            onOpenBadges={() => setView({ kind: 'settings', route: 'badges' })}
            onOpenRecipes={() => setView({ kind: 'settings', route: 'library' })}
            onOpenRecipe={(recipeId) =>
              setView({ kind: 'settings', route: 'library', recipeId })
            }
            onAdd={(day, meal) =>
              setView({ kind: 'log', meal, day, back: { kind: 'tabs' } })
            }
          />
        )}
        {tab === 'history' && (
          <HistoryScreen onOpenDay={(day) => setView({ kind: 'day', day })} />
        )}
        {tab === 'insights' && <InsightsScreen />}
        {tab === 'settings' && (
          <SettingsScreen
            onOpen={(route) => setView({ kind: 'settings', route })}
            onConnect={() => setView({ kind: 'connect' })}
          />
        )}
      </main>

      <TabBar
        active={tab}
        onSelect={setTab}
        onLog={() => setView({ kind: 'log', meal: mealForHour(new Date().getHours()) })}
      />
    </div>
  )
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-page text-ink-muted">
      {children}
    </div>
  )
}
