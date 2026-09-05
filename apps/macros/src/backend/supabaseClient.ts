import { supabaseSingleton } from '@tracker-engine/auth'

// Load-bearing: changing this signs every existing user out.
export const getSupabase = supabaseSingleton('macros.auth')

export { isBackendConfigured } from '@tracker-engine/auth'
