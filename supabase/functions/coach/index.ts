/**
 * The AI coach Edge Function (§13).
 *
 * The one place the Gemini API key is used — it lives only in this function's
 * secret (`GEMINI_API_KEY`), never in the client bundle (§2). The client sends
 * the *de-identified* summary and a request kind; this builds a constrained
 * prompt, calls Gemini with a response JSON Schema so the output deserializes
 * straight into the app's typed shape, and returns it.
 *
 * The request is authenticated by the gateway (verify_jwt = true), so only a
 * signed-in user reaches this. A small per-user in-memory rate limit guards the
 * free tier against a runaway client.
 *
 * Deploy:  supabase functions deploy coach
 * Secret:  supabase secrets set GEMINI_API_KEY=...
 */

// @ts-nocheck — Deno runtime; typed against the Deno std lib at deploy time.

const GEMINI_MODEL = 'gemini-flash-latest'
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Response schemas, one per request kind. Mirror src/features/coach/types.ts.
const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    observations: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['observations', 'suggestions'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                sets: { type: 'integer' },
                repLow: { type: 'integer' },
                repHigh: { type: 'integer' },
                weight: { type: 'number', nullable: true },
                note: { type: 'string' },
              },
              required: ['name', 'sets', 'repLow', 'repHigh', 'note'],
            },
          },
        },
        required: ['name', 'exercises'],
      },
    },
  },
  required: ['overview', 'sessions'],
}

const SYSTEM = [
  'You are a strength and conditioning coach inside a workout-tracking app.',
  'You are given a de-identified summary of a user\'s recent training: per-week',
  'and per-exercise aggregates, weights in their unit, dates only as week offsets',
  '(0 = this week, negative = past). There is no name or personal data.',
  'Be specific and grounded in the numbers. Never give medical or injury advice,',
  'never phrase anything as certainty, keep it concise. Weights you propose must',
  'be in the same unit as the summary. Only reference exercises that appear in the',
  'summary or are common barbell/dumbbell lifts by their standard name.',
].join(' ')

function promptFor(request: { kind: string; question?: string }, summaryJson: string): string {
  const base = `Training summary (JSON):\n${summaryJson}\n\n`
  switch (request.kind) {
    case 'critique':
      return (
        base +
        'Critique this training: 2–4 short standalone observations about balance, ' +
        'frequency, and progression, then concrete suggestions. Return JSON.'
      )
    case 'plan':
      return (
        base +
        'Propose next week as 1–3 sessions that continue and progress this training. ' +
        'For each exercise give sets, a rep range (repLow/repHigh), an optional ' +
        'working weight in the user\'s unit (null to let history decide), and a short ' +
        'note. Return JSON.'
      )
    case 'question':
      return base + `Answer this question from the summary, concisely: "${request.question}"`
    default:
      return base
  }
}

// ── Minimal per-user rate limit (best-effort; resets on cold start). ─────────
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 8
const hits = new Map<string, number[]>()

function rateLimited(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  recent.push(now)
  hits.set(userId, recent)
  return recent.length > RATE_MAX
}

/** Extract the Supabase user id from the verified JWT (payload.sub). */
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

  let payload: { summary?: unknown; request?: { kind?: string; question?: string } }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const request = payload.request
  const summary = payload.summary
  if (!request?.kind || !summary) return json({ error: 'Missing summary or request' }, 400)
  if (!['critique', 'plan', 'question'].includes(request.kind)) {
    return json({ error: 'Unknown request kind' }, 400)
  }

  const schema =
    request.kind === 'critique'
      ? CRITIQUE_SCHEMA
      : request.kind === 'plan'
        ? PLAN_SCHEMA
        : null // a freeform question returns plain text

  const generationConfig: Record<string, unknown> = { temperature: 0.4 }
  if (schema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseSchema = schema
  }

  const geminiBody = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ parts: [{ text: promptFor(request, JSON.stringify(summary)) }] }],
    generationConfig,
  }

  let geminiRes: Response
  try {
    geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify(geminiBody),
    })
  } catch {
    return json({ error: 'Coach is unreachable' }, 502)
  }

  if (!geminiRes.ok) {
    // Surface a coarse status; never leak the upstream body (may echo the key).
    return json({ error: `Coach upstream error (${geminiRes.status})` }, 502)
  }

  const data = await geminiRes.json()
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return json({ error: 'Coach returned nothing' }, 502)

  // Shape the response to the client's CoachResponse union.
  try {
    if (request.kind === 'critique') {
      return json({ kind: 'critique', critique: JSON.parse(text) })
    }
    if (request.kind === 'plan') {
      return json({ kind: 'plan', plan: JSON.parse(text) })
    }
    return json({ kind: 'answer', text: text.trim() })
  } catch {
    return json({ error: 'Coach returned malformed output' }, 502)
  }
})
