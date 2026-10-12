import { useLiveQuery } from 'dexie-react-hooks'
import { plural } from '@tracker-engine/core'
import { AccountScreen as BaseAccountScreen } from '@tracker-engine/auth/react'
import * as repo from '@/data/repository'
import { useAuth } from '@/auth/AuthContext'
import { useSync } from '@/sync/useSync'

export function AccountScreen({
  onBack,
  onConnectAccount,
}: {
  onBack: () => void
  onConnectAccount?: () => void
}) {
  const sync = useSync()
  const workouts = useLiveQuery(() => repo.countFinishedWorkouts(), [], 0)

  return (
    <BaseAccountScreen
      auth={useAuth()}
      onBack={onBack}
      onConnectAccount={onConnectAccount}
      unsyncedChanges={sync.pending + sync.deferred + sync.deadLettered}
      whatIsErased={`${plural(workouts, 'workout')} and every body measurement`}
      nameHint="Used for the greeting on Home."
      privacyUrl="https://reputation.fitness/app/privacy.html"
      onDeleted={async () => {
        await repo.clearLocalData()
        repo.clearDbOwner()
      }}
    />
  )
}
