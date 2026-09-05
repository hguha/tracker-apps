import { Apple } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { SignInScreen as BaseSignInScreen } from '@tracker-engine/auth/react'
import { useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'

export function SignInScreen({ onCancel }: { onCancel?: () => void } = {}) {
  const auth = useAuth()
  const isConnectMode = onCancel !== undefined

  const days = useLiveQuery(
    async () => (isConnectMode ? await repo.countLoggedDays() : undefined),
    [isConnectMode],
  )

  return (
    <BaseSignInScreen
      auth={auth}
      appName="MACROcosm"
      tagline="Log what you eat, and let the numbers find your target."
      icon={Apple}
      privacyUrl="https://reputation.fitness/app/privacy.html"
      onCancel={onCancel}
      localSummary={
        days === undefined ? undefined : `Your ${days} day${days === 1 ? '' : 's'} of meals`
      }
    />
  )
}
