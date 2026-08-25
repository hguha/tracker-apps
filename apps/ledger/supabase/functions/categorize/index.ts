/**
 * AI auto-categorization. Given a batch of merchant names + the user's categories,
 * Gemini returns a merchant→categoryId mapping (constrained JSON). The client turns
 * these into rules, so the deterministic rules engine applies them to past and future
 * transactions. The Gemini key stays server-side; only merchant names + category
 * names/ids are sent (no amounts, no account info).
 *
 * verify_jwt = true. Deploy: supabase functions deploy categorize
 * Secret: shares GEMINI_API_KEY with the coach.
 */

// @ts-nocheck — Deno runtime.

const GEMINI_MODEL = 'gemini-3.6-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

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

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'Not configured' }, 503)
  if (!userIdFromAuth(req.headers.get('Authorization'))) return json({ error: 'Unauthorized' }, 401)

  const { merchants, categories } = await req.json().catch(() => ({}))
  if (!Array.isArray(merchants) || !Array.isArray(categories) || merchants.length === 0) {
    return json({ error: 'Missing merchants/categories' }, 400)
  }
  // Bound the batch so one call can't blow the free-tier token budget.
  const list = merchants.slice(0, 100)
  const cats = categories
    .map((c: { id: string; name: string }) => `${c.id} = ${c.name}`)
    .join('\n')

  const body = {
    systemInstruction: {
      parts: [
        {
          text:
            'You categorize bank-transaction merchant names into the user\'s categories. ' +
            'For each merchant, pick the single best categoryId from this list, or "skip" if unsure:\n' +
            cats,
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: 'Merchants:\n' + list.join('\n') }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          assignments: {
            type: 'array',
            items: {
              type: 'object',
              properties: { merchant: { type: 'string' }, categoryId: { type: 'string' } },
              required: ['merchant', 'categoryId'],
            },
          },
        },
        required: ['assignments'],
      },
    },
  }

  let res: Response
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })
  } catch {
    return json({ error: 'Gemini unreachable' }, 502)
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = String((await res.json())?.error?.message ?? '').slice(0, 300)
    } catch {
      // ignore
    }
    return json({ error: `Gemini error (${res.status}): ${detail}` }, 502)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  let assignments: { merchant: string; categoryId: string }[] = []
  try {
    assignments = JSON.parse(text).assignments ?? []
  } catch {
    return json({ error: 'Malformed categorization' }, 502)
  }
  // Only keep assignments to a real category (drop "skip"/unknown ids).
  const valid = new Set(categories.map((c: { id: string }) => c.id))
  assignments = assignments.filter((a) => valid.has(a.categoryId))
  return json({ assignments })
})
