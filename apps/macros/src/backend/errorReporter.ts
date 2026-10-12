import { createErrorReporter } from '@tracker-engine/auth'
import { getSupabase } from '@/backend/supabaseClient'
import { APP_VERSION } from '@/lib/version'

export const { reportError, installGlobalErrorHandlers } = createErrorReporter({
  client: getSupabase,
  appVersion: APP_VERSION,
})
