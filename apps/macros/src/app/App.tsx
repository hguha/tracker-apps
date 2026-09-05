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
import { TrendsScreen } from '@/features/trends/TrendsScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { DataScreen } from '@/features/settings/DataScreen'
import { LogSheet } from '@/features/log/LogSheet'
import type { MealSlot } from '@/domain/types'

type View = { kind: 'tabs' } | { kind: 'account' } | { kind: 'data' } | { kind: 'connect' }

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
  return <SignedInApp />
}

/** The meal a "log food" tap defaults to, so the common case needs no extra choice. */
function currentMeal(): MealSlot {
  const hour = new Date().getHours()
  if (hour < 11) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'snack'
}

function SignedInApp() {
  const [isReady, setIsReady] = useState(false)
  const [tab, setTab] = useState<TabKey>('today')
  const [view, setView] = useState<View>({ kind: 'tabs' })
  const [logMeal, setLogMeal] = useState<MealSlot | null>(null)

  useSync()

  // Writes belong in an effect, not a live query: Dexie refuses a readwrite transaction inside
  // a liveQuery context, and a querier that writes would also re-fire on its own writes.
  useEffect(() => {
    void seedFoods()
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

  if (view.kind === 'account') {
    return <AccountScreen onBack={() => setView({ kind: 'tabs' })} />
  }
  if (view.kind === 'data') {
    return <DataScreen onBack={() => setView({ kind: 'tabs' })} />
  }
  if (view.kind === 'connect') {
    return <SignInScreen onCancel={() => setView({ kind: 'tabs' })} />
  }

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto pb-6 pt-safe">
        {tab === 'today' && <TodayScreen onLog={setLogMeal} />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'trends' && <TrendsScreen />}
        {tab === 'settings' && (
          <SettingsScreen
            onConnect={() => setView({ kind: 'connect' })}
            onOpenAccount={() => setView({ kind: 'account' })}
            onOpenData={() => setView({ kind: 'data' })}
          />
        )}
      </main>

      <TabBar active={tab} onSelect={setTab} onLog={() => setLogMeal(currentMeal())} />

      {logMeal && <LogSheet meal={logMeal} onDismiss={() => setLogMeal(null)} />}
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
