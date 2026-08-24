/**
 * Plaid Link — step 1: create a Link token.
 *
 * The client calls this, gets a short-lived link_token, and opens Plaid Link with it.
 * The Plaid client_id/secret live only in this function's secrets, never in the app.
 *
 * Scaffolded: returns 503 until PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV are set, so
 * wiring the sandbox is drop-in. See supabase/README.md for the required secrets.
 *
 * Deploy: supabase functions deploy plaid-link-token
 */

// @ts-nocheck — Deno runtime.

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
  if (!clientId || !secret) return json({ error: 'Plaid is not configured' }, 503)

  const res = await fetch(`${PLAID_HOST[env]}/link/token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      secret,
      user: { client_user_id: userId },
      client_name: 'Ledger',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    }),
  })
  const data = await res.json()
  if (!res.ok) return json({ error: data?.error_message ?? 'Plaid error' }, 502)
  return json({ link_token: data.link_token })
})
