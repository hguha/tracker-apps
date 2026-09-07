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
  mode?: 'chat' | 'estimate'
  contents?: unknown[]
  context?: unknown
  tools?: { name: string; description: string; parameters: unknown }[]
  /** For `estimate`: a meal in the user's own words, e.g. "turkey sandwich and an apple". */
  description?: string
}

/**
 * Breaking a described meal into weighed components.
 *
 * The model returns ingredient NAMES AND GRAMS ONLY — never nutrients. The client matches each
 * name against the food database and computes the macros from the matched row, so a wrong guess
 * shows up as a wrong ingredient the user can fix, never as a plausible calorie count that came
 * from nowhere.
 */
const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          // A generic, searchable name — "whole wheat bread", not "Dave's Killer Bread".
          query: { type: 'string' },
          grams: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['query', 'grams', 'confidence'],
      },
    },
    /** What had to be assumed, so the user corrects the assumption rather than the number. */
    assumptions: { type: 'string' },
  },
  required: ['items', 'assumptions'],
}

const ESTIMATE_SYSTEM = `Break a described meal into its weighed components.

Return ONLY generic, searchable ingredient names and a weight in grams for each. Never return
calories or macros — the app computes those from its own food database, and a number from you
would be a fabrication.

Rules:
- Use plain generic names a food database would hold: "whole wheat bread", "roasted turkey
  breast", "mayonnaise", "cheddar cheese". Not brands, not adjectives.
- Use ordinary portions when the user doesn't say: a sandwich is 2 slices of bread (~56 g), a
  slice of deli meat ~28 g, a teaspoon of mayo ~5 g, a medium apple ~180 g.
- Mark confidence low for any component the user did not mention and you are guessing at.
- State every assumption in one short sentence, so the user corrects the assumption rather than
  the arithmetic.
- If the description is already one recognisable dish, you may return it as a single item with
  its typical total weight.`

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

  if (body.mode === 'estimate') return estimate(key, body.description ?? '')

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

async function estimate(key: string, description: string): Promise<Response> {
  const text = description.trim()
  if (!text) return json({ error: 'description is required' }, 400)

  const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      systemInstruction: { parts: [{ text: ESTIMATE_SYSTEM }] },
      generationConfig: {
        temperature: 0.2,
        // Generous: a thinking model spends this budget on reasoning as well as output, and at
        // 800 the JSON was being truncated intermittently — which surfaced as a parse failure
        // on roughly every other "turkey sandwich".
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: ESTIMATE_SCHEMA,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    return json({ error: `Gemini ${response.status}: ${detail.slice(0, 300)}` }, 502)
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  try {
    const parsed = JSON.parse(raw) as { items?: unknown; assumptions?: unknown }
    return json({
      items: Array.isArray(parsed.items) ? parsed.items : [],
      assumptions: typeof parsed.assumptions === 'string' ? parsed.assumptions : '',
    })
  } catch {
    // Include what came back: a truncated response and a refusal look identical otherwise.
    return json({ error: `Could not read the estimate: ${raw.slice(0, 200)}` }, 502)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
