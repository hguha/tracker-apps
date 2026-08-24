// Re-exported from @tracker-engine/auth; shim so existing '@/auth/types' importers don't change.
export type { AuthProvider, Session, SignInResult } from '@tracker-engine/auth'
export {
  CODE_MAX_LENGTH,
  CODE_MIN_LENGTH,
  initialsOf,
  isSubmittableCode,
  isValidEmail,
} from '@tracker-engine/auth'
