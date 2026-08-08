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
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

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

const PLAN_EXERCISE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    sets: { type: 'integer' },
    repLow: { type: 'integer' },
    repHigh: { type: 'integer' },
    weight: { type: 'number', nullable: true },
    note: { type: 'string' },
    autoProgress: { type: 'boolean' },
  },
  required: ['name', 'sets', 'repLow', 'repHigh', 'note', 'autoProgress'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    programName: { type: 'string', nullable: true },
    durationWeeks: { type: 'integer', nullable: true },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          exercises: { type: 'array', items: PLAN_EXERCISE_SCHEMA },
        },
        required: ['name', 'exercises'],
      },
    },
  },
  required: ['overview', 'programName', 'durationWeeks', 'sessions'],
}

/** Ask can answer in prose OR return a plan — the model picks `mode`. */
const ASK_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['text', 'plan'] },
    text: { type: 'string', nullable: true },
    plan: { ...PLAN_SCHEMA, nullable: true },
  },
  required: ['mode'],
}

const SYSTEM = [
  'You are an expert strength & conditioning coach inside a workout-tracking app.',
  "INPUT: a de-identified summary of the user's recent training — per-week and",
  "per-exercise aggregates, weights already in the user's unit, dates only as week",
  'offsets (0 = this week, negative = past). It also carries their bodyweight,',
  'height, and a free-text training goal when set. No other personal data. You are',
  'also given the list of exercise names available in the app.',
  '',
  'RULES:',
  '- Ground every claim in the numbers you were given; do not invent history.',
  '- Factor bodyweight, height, and the stated goal into your advice when present',
  '  (e.g. relative-strength framing, sensible starting loads). Never comment on',
  '  appearance or weight in a judgmental way.',
  '- Prefer exercises from the provided library list, by their exact name, so the',
  '  app can save them. A well-known barbell/dumbbell lift is acceptable if absent.',
  "- Weights you propose are in the user's unit. Use null to let the app seed the",
  '  weight from history when they have done the lift; give a real starting number',
  '  for a lift new to them, informed by their bodyweight and comparable lifts.',
  '- Set autoProgress=true on straight-set compound work that should add weight over',
  '  time; false for rep-range accessory or cardio work.',
  "- Build toward the user's STATED GOAL, taken literally, even if that means an",
  '  unbalanced emphasis. A goal like "lower body split" means BUILD A LOWER-BODY',
  '  PLAN — do not substitute their most-trained lifts. Only rebalance if the goal',
  '  itself asks for balance or is blank. Do NOT simply pile more volume onto',
  '  whatever they already do most.',
  '- Plans should be complete and intuitive: 4–7 exercises per session, a clear',
  '  lead compound then accessories, realistic set/rep schemes for the goal',
  '  (strength ~3–6 reps, hypertrophy ~8–12), and a one-line note per exercise.',
  '- Never give medical or injury advice; never phrase anything as certainty; be',
  '  concise and concrete.',
].join('\n')

function promptFor(
  request: { kind: string; goal?: string; question?: string },
  summaryJson: string,
  libraryNames: string[],
): string {
  const context =
    `Training summary (JSON):\n${summaryJson}\n\n` +
    `Available exercises (use these exact names where possible):\n` +
    `${libraryNames.join(', ')}\n\n`

  switch (request.kind) {
    case 'critique':
      return (
        context +
        'Critique this training in 2–4 short, standalone observations about balance, ' +
        'frequency, and progression, then give concrete suggestions.'
      )
    case 'plan': {
      // A per-request goal wins; otherwise use the standing profile goal carried
      // in the summary (summaryJson has trainingGoal), else propose a balanced week.
      const goal = (request.goal ?? '').trim()
      const goalLine = goal
        ? `The user's goal for THIS plan: "${goal}". Build the plan toward it, literally.`
        : "No goal was given for this specific request. If the summary's " +
          'trainingGoal field is non-empty, build toward that; otherwise propose ' +
          'a balanced next week that continues and progresses their training and ' +
          'fills obvious gaps.'
      return (
        context +
        goalLine +
        '\n\nProduce a plan. If the goal implies a multi-week program (e.g. "12-week ' +
        'strength block"), set programName and durationWeeks, and design the weekly ' +
        'sessions to be repeated with autoProgress carrying the load increases over ' +
        'the weeks — do NOT emit a separate session per week. Otherwise set ' +
        'programName and durationWeeks to null for a single week. Each session ' +
        'becomes one saved template; give it a clear name (e.g. "Push A", "Lower B").'
      )
    }
    case 'ask': {
      return (
        context +
        `The user asks: "${request.question}".\n\n` +
        'If answering well means proposing workouts (e.g. "give me a push day", ' +
        '"design a 12-week program"), set mode="plan" and fill `plan` using the same ' +
        'rules as a plan request (programName/durationWeeks for multi-week, else ' +
        'null). Otherwise set mode="text" and answer concisely in `text`.'
      )
    }
    case 'encouragement':
      return (
        context +
        "Write a warm, specific 1–2 sentence note about this person's recent " +
        'progress, for a home-screen greeting. Reference something concrete from ' +
        'the numbers (a lift moving up, a consistent week, sticking with it). ' +
        'Encouraging, never corrective, never a full critique. Return JSON: ' +
        '{ "mode": "text", "text": "..." }.'
      )
    default:
      return context
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

  let payload: {
    summary?: unknown
    library?: unknown
    request?: { kind?: string; goal?: string; question?: string }
  }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const request = payload.request
  const summary = payload.summary
  if (!request?.kind || !summary)
    return json({ error: 'Missing summary or request' }, 400)
  if (!['critique', 'plan', 'ask', 'encouragement'].includes(request.kind)) {
    return json({ error: 'Unknown request kind' }, 400)
  }
  // The exercise-name allowlist, so proposed plans use lifts the app can save.
  const library = Array.isArray(payload.library)
    ? (payload.library as unknown[]).filter((n): n is string => typeof n === 'string')
    : []

  // Encouragement reuses the ask schema (it returns { mode:'text', text }).
  const schema =
    request.kind === 'critique'
      ? CRITIQUE_SCHEMA
      : request.kind === 'plan'
        ? PLAN_SCHEMA
        : ASK_SCHEMA

  const generationConfig: Record<string, unknown> = {
    temperature: 0.5,
    responseMimeType: 'application/json',
    responseSchema: schema,
  }

  const geminiBody = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      { parts: [{ text: promptFor(request, JSON.stringify(summary), library) }] },
    ],
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
    // Ask: the model chose text or a plan.
    const parsed = JSON.parse(text)
    if (parsed.mode === 'plan' && parsed.plan) {
      return json({ kind: 'plan', plan: parsed.plan })
    }
    return json({ kind: 'answer', text: (parsed.text ?? '').trim() })
  } catch {
    return json({ error: 'Coach returned malformed output' }, 502)
  }
})
