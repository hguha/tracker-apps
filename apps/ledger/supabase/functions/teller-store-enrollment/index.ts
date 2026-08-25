/**
 * Teller Connect — store the enrollment.
 *
 * After the user completes Teller Connect in the app, the client gets an
 * `accessToken` + `enrollmentId`. This stores them server-side (teller_enrollments,
 * deny-all RLS) so the token never lives in the client and `teller-sync` can use it.
 *
 * Scaffolded: needs SUPABASE_SERVICE_ROLE_KEY (auto-injected). No Teller secret needed
 * for storage — the cert is only needed by teller-sync to call the Teller API.
 *
 * Deploy: supabase functions deploy teller-store-enrollment
 */

// @ts-nocheck — Deno runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function userIdFromAuth(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const payload = authHeader.slice(7).split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  const userId = userIdFromAuth(req.headers.get('Authorization'))
  if (!userId) return json({ error: 'Unauthorized' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 503)

  const { accessToken, enrollmentId, institution } = await req.json().catch(() => ({}))
  if (!accessToken || !enrollmentId) {
    return json({ error: 'Missing accessToken/enrollmentId' }, 400)
  }

  const admin = createClient(url, serviceKey)
  const { error } = await admin.from('teller_enrollments').upsert({
    enrollment_id: enrollmentId,
    user_id: userId,
    access_token: accessToken,
    institution: institution ?? null,
  })
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true })
})
