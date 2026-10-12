import { installAuthDeepLinks } from '@tracker-engine/auth'
import { getSupabase } from '@/backend/supabaseClient'

export const initDeepLinks = (): void => installAuthDeepLinks(getSupabase)
