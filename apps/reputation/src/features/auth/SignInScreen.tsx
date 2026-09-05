import { Dumbbell } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { SignInScreen as BaseSignInScreen } from '@tracker-engine/auth/react'
import { useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'

export function SignInScreen({ onCancel }: { onCancel?: () => void } = {}) {
  const auth = useAuth()
  const isConnectMode = onCancel !== undefined

  // Only counted when upgrading a device-only account, to say what's about to move.
  const workouts = useLiveQuery(
    async () => (isConnectMode ? await repo.countFinishedWorkouts() : undefined),
    [isConnectMode],
  )

  return (
    <BaseSignInScreen
      auth={auth}
      appName="REPutation"
      tagline="Log your lifts, watch the numbers move."
      icon={Dumbbell}
      privacyUrl="https://reputation.fitness/app/privacy.html"
      onCancel={onCancel}
      localSummary={
        workouts === undefined
          ? undefined
          : `Your ${workouts} workout${workouts === 1 ? '' : 's'}`
      }
      recovery={{
        begin: auth.beginPasswordRecovery,
        clear: auth.clearPasswordRecovery,
      }}
    />
  )
}
