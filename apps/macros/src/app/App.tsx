import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ToastProvider, useColorScheme } from '@tracker-engine/ui'
import { applyStatusBarStyle } from '@tracker-engine/platform'
import { AuthProviderScope, useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { applyAppearance } from '@/lib/theme'
import { useSync } from '@/sync/useSync'
import { TabBar, type TabKey } from './TabBar'
import { SignInScreen } from '@/features/auth/SignInScreen'
import { SetPasswordScreen } from '@/features/auth/SetPasswordScreen'
import { AccountScreen } from '@/features/auth/AccountScreen'
import { OnboardingScreen, ONBOARDING_VERSION } from '@/features/onboarding/OnboardingScreen'
import { TodayScreen } from '@/features/today/TodayScreen'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { InsightsScreen } from '@/features/insights/InsightsScreen'
import { SettingsScreen, type SettingsRoute } from '@/features/settings/SettingsScreen'
import { DataScreen } from '@/features/settings/DataScreen'
import { TargetsScreen } from '@/features/settings/TargetsScreen'
import { AboutYouScreen } from '@/features/settings/AboutYouScreen'
import { PreferencesScreen } from '@/features/settings/PreferencesScreen'
import { AppearanceScreen } from '@/features/settings/AppearanceScreen'
import { BadgesScreen } from '@/features/badges/BadgesScreen'
import { SavedMealsScreen } from '@/features/settings/SavedMealsScreen'
import { CheckInScreen } from '@/features/checkin/CheckInScreen'
import { CoachScreen } from '@/features/coach/CoachScreen'
import { LogScreen } from '@/features/log/LogScreen'
import { mealForHour } from '@/features/shared/meals'
import type { MealSlot } from '@/domain/types'

type View =
  | { kind: 'tabs' }
  | { kind: 'log'; meal: MealSlot }
  | { kind: 'settings'; route: SettingsRoute }
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
      .then(() => repo.runCheckIn())
      .then(() => setIsReady(true))
      .catch(() => setIsReady(true))
  }, [])

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
  if (view.kind === 'log') return <LogScreen meal={view.meal} onClose={toTabs} />
  if (view.kind === 'settings') {
    switch (view.route) {
      case 'targets':
        return <TargetsScreen onBack={toTabs} />
      case 'about':
        return <AboutYouScreen onBack={toTabs} />
      case 'preferences':
        return <PreferencesScreen onBack={toTabs} />
      case 'appearance':
        return <AppearanceScreen onBack={toTabs} />
      case 'badges':
        return <BadgesScreen onBack={toTabs} />
      case 'meals':
        return <SavedMealsScreen onBack={toTabs} />
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
            onLog={(meal) => setView({ kind: 'log', meal })}
            onOpenCoach={() => setView({ kind: 'settings', route: 'coach' })}
            onOpenAbout={() => setView({ kind: 'settings', route: 'about' })}
            onOpenBadges={() => setView({ kind: 'settings', route: 'badges' })}
          />
        )}
        {tab === 'history' && <HistoryScreen />}
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
