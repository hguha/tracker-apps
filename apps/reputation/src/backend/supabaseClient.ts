import { supabaseSingleton } from '@tracker-engine/auth'

// 'fitnote.auth' predates the rebrand and must not change — it's where existing sessions live.
export const getSupabase = supabaseSingleton('fitnote.auth')

export { isBackendConfigured } from '@tracker-engine/auth'
