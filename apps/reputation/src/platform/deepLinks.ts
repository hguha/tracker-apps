import { installAuthDeepLinks } from '@tracker-engine/auth'
import { getSupabase } from '@/backend/supabaseClient'

export const NATIVE_REDIRECT_URL = 'fitnote://auth-callback'

export const initDeepLinks = (): void => installAuthDeepLinks(getSupabase, NATIVE_REDIRECT_URL)
