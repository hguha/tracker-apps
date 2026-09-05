// The coach's server half: holds GEMINI_API_KEY, forwards one chat round, and returns either
// the model's text or the tool calls it wants run. Tools execute on the CLIENT against
// IndexedDB, so the user's food diary never leaves the device — only the small opening context
// and whatever a tool result summarises.
//
// Env: GEMINI_API_KEY. Requires a JWT (verify_jwt defaults on), so a device-only user falls
// back to the offline coach rather than reaching this.

const MODEL = 'gemini-3.6-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

const SYSTEM = `You are the coach inside MACROcosm, a calorie and macro tracker.

How this app works, and you must not contradict it:
- The user's calorie target comes from their MEASURED expenditure — computed from their weight
  trend and what they logged — not from a formula and not from a fitness tracker.
- That measured expenditure ALREADY INCLUDES their training. Never tell them to eat back
  exercise calories, and never add a workout on top of their budget.
- Judge progress by the weight TREND, never a single weigh-in. Daily weight swings on water.
- A single day over or under target does not matter; the weekly average moves the trend.

Rules you must follow:
- Call tools to get real numbers. Never guess or recall a value you were not given.
- Before proposing anything to log, call searchFoods and use a real foodId. You must never
  state calories or macros you invented — the app computes them from the food database.
- Be brief and concrete. Two or three sentences unless asked for more.
- You are not a clinician. Do not diagnose, and do not set targets below conventional safety
  floors; if asked to, say why you won't and suggest a slower rate instead.`

interface Body {
  contents?: unknown[]
  context?: unknown
  tools?: { name: string; description: string; parameters: unknown }[]
}

// A browser preflights every cross-origin POST, so without these the function is unreachable
// from the app entirely — which unit tests and an empty-env E2E run can never surface.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405)

  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: 'GEMINI_API_KEY is not configured' }, 503)

  const body = (await request.json().catch(() => ({}))) as Body
  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return json({ error: 'contents is required' }, 400)
  }

  const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: body.contents,
      systemInstruction: {
        parts: [
          { text: SYSTEM },
          { text: `Opening context (JSON): ${JSON.stringify(body.context ?? {})}` },
        ],
      },
      ...(body.tools?.length
        ? { tools: [{ functionDeclarations: body.tools }] }
        : {}),
      generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    // 429 is the free tier doing its job; the client falls back to its offline coach.
    return json({ error: `Gemini ${response.status}: ${detail.slice(0, 300)}` }, 502)
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: Record<string, unknown>[] } }[]
  }
  const parts = payload.candidates?.[0]?.content?.parts ?? []
  const calls = parts
    .filter((part) => part.functionCall)
    .map((part) => part.functionCall as { name: string; args: Record<string, unknown> })
  const text = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim()

  if (calls.length > 0) {
    // `modelParts` goes back verbatim: each functionCall carries an opaque thoughtSignature
    // that MUST be echoed on the next turn or Gemini rejects the request.
    return json({ kind: 'toolCalls', calls, modelParts: parts, text })
  }
  return json({ kind: 'message', text })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
