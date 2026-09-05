import { LocalAuthProvider as BaseLocalAuthProvider } from '@tracker-engine/auth'
import { db } from '@/db'

export class LocalAuthProvider extends BaseLocalAuthProvider {
  constructor() {
    super({
      sessionKey: 'ledger.session',
      // Wiping matters: rows left behind would let the next device-only account read the
      // previous one's, which no server policy can prevent because the server isn't involved.
      wipeLocalData: async () => {
        await db.delete()
        await db.open()
      },
    })
  }
}

export { LOCAL_USER_ID, LOCAL_DEV_CODE, deriveName } from '@tracker-engine/auth'
