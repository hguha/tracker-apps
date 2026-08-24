/**
 * The Ledger finance coach Edge Function.
 *
 * The one place the Gemini API key is used — it lives only in this function's secret
 * (`GEMINI_API_KEY`), never in the client bundle. Chat-only: the client holds the
 * conversation and runs the retrieval tools locally against the ledger; this is a
 * stateless relay of one Gemini round with the tool declarations. The model only ever
 * sees the de-identified aggregates the tools return.
 *
 * verify_jwt = true (config.toml), so only a signed-in user reaches this and the
 * per-user rate-limit key can't be forged.
 *
 * Deploy:  supabase functions deploy coach
 * Secret:  supabase secrets set GEMINI_API_KEY=...
 */

// @ts-nocheck — Deno runtime; typed against the Deno std lib at deploy time.

const GEMINI_MODEL = 'gemini-3.6-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

async function fetchGeminiWithRetry(body: unknown, apiKey: string): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })
    if (res.status !== 503) return res
    last = res
    if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
  }
  return last!
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CHAT_SYSTEM =
  'You are Ledger Coach, a sharp, friendly personal-finance assistant chatting with the user inside their expense-tracking app. ' +
  'Use the tools to look up the real numbers before answering — never invent figures. ' +
  'Amounts from tools are in dollars. Be concise and concrete: name the category or merchant and the amount. ' +
  'When the user wants to control spending, call suggest_budget with a realistic monthly cap so they get an actionable card. ' +
  'You only ever see de-identified aggregates (categories, merchants, totals) — no account numbers — so never claim to see more.'

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 40
const hits = new Map<string, number[]>()

function rateLimited(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  recent.push(now)
  hits.set(userId, recent)
  return recent.length > RATE_MAX
}

// Reads the JWT `sub` WITHOUT verifying — safe only because the gateway already
// verified it (config.toml verify_jwt = true, which must stay true).
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

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'Coach is not configured' }, 503)

  const userId = userIdFromAuth(req.headers.get('Authorization'))
  if (!userId) return json({ error: 'Unauthorized' }, 401)
  if (rateLimited(userId)) return json({ error: 'Too many requests — slow down' }, 429)

  const MAX_BODY_BYTES = 256 * 1024
  if (Number(req.headers.get('Content-Length') ?? '0') > MAX_BODY_BYTES) {
    return json({ error: 'Request too large' }, 413)
  }

  let payload: { mode?: string; contents?: unknown; context?: unknown; tools?: unknown }
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request too large' }, 413)
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (payload.mode !== 'chat') return json({ error: 'Unsupported mode' }, 400)

  const contents = Array.isArray(payload.contents) ? payload.contents : null
  const rawTools = Array.isArray(payload.tools) ? payload.tools : []
  if (!contents) return json({ error: 'Missing conversation' }, 400)

  // Gemini rejects an OBJECT-typed parameters with no properties, so no-arg tools
  // must omit `parameters` entirely.
  const functionDeclarations = rawTools.map((decl: Record<string, unknown>) => {
    const params = decl.parameters as { properties?: Record<string, unknown> } | undefined
    if (!params?.properties || Object.keys(params.properties).length === 0) {
      const { parameters: _drop, ...rest } = decl
      return rest
    }
    return decl
  })

  const chatBody = {
    systemInstruction: {
      parts: [
        {
          text:
            CHAT_SYSTEM +
            '\n\nCONTEXT (the current view; JSON):\n' +
            JSON.stringify(payload.context ?? {}),
        },
      ],
    },
    contents,
    tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
    generationConfig: { temperature: 0.5, thinkingConfig: { thinkingBudget: 128 } },
  }

  let chatRes: Response
  try {
    chatRes = await fetchGeminiWithRetry(chatBody, apiKey)
  } catch {
    return json({ error: 'Coach is unreachable' }, 502)
  }

  if (chatRes.status === 429 || chatRes.status === 503) {
    let detail = ''
    try {
      detail = String((await chatRes.json())?.error?.message ?? '').slice(0, 400)
    } catch {
      // ignore
    }
    return json({ kind: 'message', text: `⚠️ Gemini ${chatRes.status}: ${detail || 'busy'}` })
  }
  if (!chatRes.ok) {
    let detail = ''
    try {
      detail = String((await chatRes.json())?.error?.message ?? '').slice(0, 300)
    } catch {
      // ignore
    }
    return json({ error: `Coach upstream error (${chatRes.status}): ${detail}` }, 502)
  }

  const chatData = await chatRes.json()
  const parts = chatData?.candidates?.[0]?.content?.parts ?? []
  const calls = parts
    .filter((p: { functionCall?: unknown }) => p.functionCall)
    .map((p: { functionCall: { name: string; args?: unknown } }) => ({
      name: p.functionCall.name,
      args: p.functionCall.args ?? {},
    }))
  const text = parts
    .filter((p: { text?: unknown }) => typeof p.text === 'string')
    .map((p: { text: string }) => p.text)
    .join('')
    .trim()

  // Return the raw parts too — each functionCall's thoughtSignature must be echoed
  // back verbatim next turn, so the client appends these rather than rebuilding them.
  if (calls.length > 0) return json({ kind: 'toolCalls', calls, modelParts: parts, text })
  return json({
    kind: 'message',
    text: text || "I'm not sure how to help with that — could you rephrase?",
  })
})
