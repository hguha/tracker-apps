/**
 * Account deletion (§11.1.2).
 *
 * Deleting a user requires the service role, which must never reach the client —
 * so it happens here. Removing the row from `auth.users` cascades to every owned
 * row (`... references auth.users(id) on delete cascade` on every user table), so
 * this deletes the auth user and the data goes with it.
 *
 * The caller is identified from their verified JWT (`verify_jwt = true` at the
 * gateway, see config.toml), so a user can only ever delete themselves — the id
 * is never taken from the request body.
 *
 * Deploy:  supabase functions deploy delete-account
 */

// @ts-nocheck — Deno runtime; typed against the Deno std lib at deploy time.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// The caller's own id, from the gateway-verified JWT — never from the body.
function userIdFromAuth(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const payload = authHeader.slice(7).split('.')[1]
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.sub === 'string' ? json.sub : null
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

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const userId = userIdFromAuth(req.headers.get('Authorization'))
  if (!userId) return json({ error: 'Unauthorized' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 503)

  const admin = createClient(url, serviceKey)
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true })
})
