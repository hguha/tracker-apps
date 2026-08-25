/**
 * Teller — pull accounts + transactions into the (server-authored) tables.
 *
 * Reads the user's enrollment access_tokens (server-side), calls the Teller API with
 * the client certificate (mTLS) + HTTP Basic auth (token as username), and upserts
 * balances + transactions with the service role. Amounts are normalized to
 * COINcidence's convention: integer minor units, outflow negative (Teller already
 * signs debits negative). The client then pulls the results through normal sync.
 *
 * Auth to Teller needs a client certificate. Provide it as PEM in secrets:
 *   supabase secrets set TELLER_CERT="$(cat certificate.pem)"
 *   supabase secrets set TELLER_KEY="$(cat private_key.pem)"
 * (Deno supports mTLS via Deno.createHttpClient; sandbox test tokens work without it.)
 *
 * Scaffolded: returns 503 until the cert secrets are set.
 *
 * Deploy: supabase functions deploy teller-sync
 */

// @ts-nocheck — Deno runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TELLER_API = 'https://api.teller.io'

function userIdFromAuth(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const payload = authHeader.slice(7).split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null
  } catch {
    return null
  }
}

const toMinor = (amount: string | number) => Math.round(Number(amount) * 100)

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
  const cert = Deno.env.get('TELLER_CERT')
  const key = Deno.env.get('TELLER_KEY')
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 503)
  if (!cert || !key) return json({ error: 'Teller certificate not configured' }, 503)

  // mTLS client for every Teller call.
  const httpClient = Deno.createHttpClient({ cert, key })
  const admin = createClient(url, serviceKey)

  const { data: enrollments } = await admin
    .from('teller_enrollments')
    .select('*')
    .eq('user_id', userId)
  if (!enrollments?.length) return json({ error: 'No linked bank' }, 400)

  let accountCount = 0
  let txnCount = 0

  for (const e of enrollments) {
    const auth = 'Basic ' + btoa(`${e.access_token}:`)
    const tellerGet = (path: string) =>
      fetch(`${TELLER_API}${path}`, {
        headers: { Authorization: auth },
        client: httpClient,
      }).then((r) => r.json())

    const accounts = await tellerGet('/accounts')
    for (const a of accounts ?? []) {
      const bal = await tellerGet(`/accounts/${a.id}/balances`).catch(() => ({}))
      await admin.from('accounts').upsert({
        id: a.id,
        user_id: userId,
        name: a.name,
        institution: a.institution?.name ?? e.institution,
        mask: a.last_four ?? '',
        type: a.type ?? 'depository',
        current_balance_minor: toMinor(bal?.ledger ?? bal?.available ?? 0),
        currency: a.currency ?? 'USD',
      })
      accountCount += 1

      const txns = await tellerGet(`/accounts/${a.id}/transactions?count=200`)
      const rows = (txns ?? []).map((t: Record<string, unknown>) => ({
        id: t.id,
        user_id: userId,
        account_id: a.id,
        category_id: null, // the user (and rules/AI) categorize; overrides sync separately
        amount_minor: toMinor(t.amount as string), // Teller signs debits negative
        currency: a.currency ?? 'USD',
        date: t.date,
        merchant: t.description ?? '',
        pending: t.status === 'pending',
      }))
      if (rows.length) {
        await admin.from('transactions').upsert(rows)
        txnCount += rows.length
      }
    }
  }

  httpClient.close()
  return json({ ok: true, accounts: accountCount, transactions: txnCount })
})
