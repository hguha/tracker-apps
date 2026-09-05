import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ToastProvider } from '@tracker-engine/ui'
import { AuthProviderScope, useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'
import { seedFoods } from '@/db/seed'
import { applyAppearance } from '@/lib/theme'
import { TabBar, type TabKey } from './TabBar'
import { TodayScreen } from '@/features/today/TodayScreen'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { TrendsScreen } from '@/features/trends/TrendsScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { LogSheet } from '@/features/log/LogSheet'
import type { MealSlot } from '@/domain/types'

export function App() {
  return (
    <AuthProviderScope>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AuthProviderScope>
  )
}

/** The meal a "log food" tap defaults to, so the common case needs no extra choice. */
function currentMeal(): MealSlot {
  const hour = new Date().getHours()
  if (hour < 11) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'snack'
}

function Shell() {
  const { isLoading } = useAuth()
  const [tab, setTab] = useState<TabKey>('today')
  const [logMeal, setLogMeal] = useState<MealSlot | null>(null)

  // Reference data and appearance, both needed before anything reads them, then the weekly
  // recalculation. Check-in runs at boot rather than on a timer: the week it's about has
  // already ended, so there's nothing to be timely about.
  useLiveQuery(async () => {
    await seedFoods()
    const profile = await repo.getProfile()
    applyAppearance({ theme: profile.theme, colorScheme: profile.colorScheme })
    await repo.runCheckIn()
    return true
  }, [])

  if (isLoading) return <div className="h-full bg-page" />

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto pb-6 pt-safe">
        {tab === 'today' && <TodayScreen onLog={setLogMeal} />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'trends' && <TrendsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      <TabBar active={tab} onSelect={setTab} onLog={() => setLogMeal(currentMeal())} />

      {logMeal && <LogSheet meal={logMeal} onDismiss={() => setLogMeal(null)} />}
    </div>
  )
}
