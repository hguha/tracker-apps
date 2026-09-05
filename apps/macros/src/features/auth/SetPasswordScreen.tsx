import { SetPasswordScreen as BaseSetPasswordScreen } from '@tracker-engine/auth/react'
import { useAuth } from '@/auth/AuthContext'

export function SetPasswordScreen() {
  return <BaseSetPasswordScreen auth={useAuth()} />
}
