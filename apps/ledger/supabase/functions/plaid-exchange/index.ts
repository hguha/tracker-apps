/**
 * Plaid Link — step 2: exchange the public_token for a long-lived access_token and
 * store it server-side (plaid_items). The access_token NEVER goes to the client.
 *
 * Scaffolded: returns 503 until PLAID_* secrets are set.
 *
 * Deploy: supabase functions deploy plaid-exchange
 */

// @ts-nocheck — Deno runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PLAID_HOST: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
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

  const clientId = Deno.env.get('PLAID_CLIENT_ID')
  const secret = Deno.env.get('PLAID_SECRET')
  const env = Deno.env.get('PLAID_ENV') ?? 'sandbox'
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!clientId || !secret || !url || !serviceKey) {
    return json({ error: 'Plaid is not configured' }, 503)
  }

  const { public_token } = await req.json().catch(() => ({}))
  if (!public_token) return json({ error: 'Missing public_token' }, 400)

  const res = await fetch(`${PLAID_HOST[env]}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, secret, public_token }),
  })
  const data = await res.json()
  if (!res.ok) return json({ error: data?.error_message ?? 'Plaid error' }, 502)

  // Store the access_token with the service role (bypasses the deny-all RLS).
  const admin = createClient(url, serviceKey)
  const { error } = await admin.from('plaid_items').upsert({
    item_id: data.item_id,
    user_id: userId,
    access_token: data.access_token,
  })
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, item_id: data.item_id })
})
