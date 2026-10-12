import { AccountScreen as BaseAccountScreen } from '@tracker-engine/auth/react'
import { useAuth } from '@/auth/AuthContext'
import * as repo from '@/data/repository'
import { useSyncStatus } from '@/sync/useSync'
import { PRIVACY_URL } from './SignInScreen'

export function AccountScreen({
  onBack,
  onConnect,
}: {
  onBack: () => void
  onConnect?: () => void
}) {
  const sync = useSyncStatus()
  return (
    <BaseAccountScreen
      auth={useAuth()}
      onBack={onBack}
      onConnectAccount={onConnect}
      unsyncedChanges={sync.pending + sync.deferred + sync.deadLettered}
      whatIsErased="every log, recipe, weigh-in and check-in"
      nameHint="Shown at the top of Settings."
      privacyUrl={PRIVACY_URL}
      onRenamed={(displayName) => repo.saveProfile({ displayName })}
      onDeleted={async () => {
        await repo.clearLocalData()
        repo.clearDbOwner()
      }}
    />
  )
}
