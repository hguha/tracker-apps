/**
 * Plaid — step 3: pull the user's accounts + transactions and write them into the
 * (server-authored) accounts/transactions tables with the service role. The client
 * then picks them up on its next normal pull. The Plaid access_token is read from
 * plaid_items server-side and never leaves this function.
 *
 * Amounts are normalized to Ledger's convention: integer minor units, outflow
 * negative. Uses /transactions/sync with a persisted cursor so re-runs are
 * incremental.
 *
 * Scaffolded: returns 503 until PLAID_* secrets are set.
 *
 * Deploy: supabase functions deploy plaid-sync
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

const toMinor = (n: number) => Math.round(n * 100)

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
  const host = PLAID_HOST[env]
  const plaid = (path: string, body: Record<string, unknown>) =>
    fetch(`${host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, secret, ...body }),
    }).then((r) => r.json())

  const admin = createClient(url, serviceKey)
  const { data: items } = await admin.from('plaid_items').select('*').eq('user_id', userId)
  if (!items?.length) return json({ error: 'No linked bank' }, 400)

  let accountCount = 0
  let txnCount = 0

  for (const item of items) {
    // Balances → accounts.
    const balances = await plaid('/accounts/get', { access_token: item.access_token })
    for (const a of balances.accounts ?? []) {
      const sign = a.type === 'credit' || a.type === 'loan' ? -1 : 1
      await admin.from('accounts').upsert({
        id: a.account_id,
        user_id: userId,
        name: a.name,
        institution: item.institution,
        mask: a.mask ?? '',
        type: a.type,
        current_balance_minor: toMinor((a.balances?.current ?? 0) * sign),
        currency: a.balances?.iso_currency_code ?? 'USD',
      })
      accountCount += 1
    }

    // Incremental transactions via cursor.
    let cursor = item.cursor ?? undefined
    let hasMore = true
    while (hasMore) {
      const page = await plaid('/transactions/sync', {
        access_token: item.access_token,
        cursor,
      })
      const rows = [...(page.added ?? []), ...(page.modified ?? [])].map((t) => ({
        id: t.transaction_id,
        user_id: userId,
        account_id: t.account_id,
        category_id: null, // the user categorizes; overrides sync separately
        amount_minor: toMinor(-t.amount), // Plaid: positive = outflow → negate
        currency: t.iso_currency_code ?? 'USD',
        date: t.date,
        merchant: t.merchant_name ?? t.name ?? '',
        pending: Boolean(t.pending),
      }))
      if (rows.length) {
        await admin.from('transactions').upsert(rows)
        txnCount += rows.length
      }
      for (const removed of page.removed ?? []) {
        await admin
          .from('transactions')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', removed.transaction_id)
      }
      cursor = page.next_cursor
      hasMore = Boolean(page.has_more)
    }
    await admin.from('plaid_items').update({ cursor }).eq('item_id', item.item_id)
  }

  return json({ ok: true, accounts: accountCount, transactions: txnCount })
})
