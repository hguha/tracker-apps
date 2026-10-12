import { installAuthDeepLinks } from '@tracker-engine/auth'
import { getSupabase } from '@/backend/supabaseClient'
import { NATIVE_REDIRECT_URL } from '@/auth/supabaseAuthProvider'

export const initDeepLinks = (): void => installAuthDeepLinks(getSupabase, NATIVE_REDIRECT_URL)
