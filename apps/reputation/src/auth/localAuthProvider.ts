import { LocalAuthProvider as BaseLocalAuthProvider } from '@tracker-engine/auth'
import { db } from '@/db/database'
import { clearDbOwner } from '@/db/owner'

export class LocalAuthProvider extends BaseLocalAuthProvider {
  constructor() {
    super({
      sessionKey: 'workout-tracker.session',
      onDisplayName: async (userId, displayName) => {
        const profile = await db.profiles.get(userId)
        if (!profile || profile.displayName === displayName) return
        await db.profiles.update(userId, {
          displayName,
          updatedAt: Date.now(),
          clientRev: profile.clientRev + 1,
        })
      },
      wipeLocalData: async () => {
        await db.delete()
        await db.open()
        // The database is gone, so the ownership marker must go with it — a stale marker
        // would make the next sign-in look like a foreign account.
        clearDbOwner()
      },
    })
  }
}

export { LOCAL_DEV_CODE, deriveName } from '@tracker-engine/auth'
