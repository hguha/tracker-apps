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

// Pinned GA model, not a floating `-latest` preview alias (that one routed to a
// low-capacity preview that 503'd on demand spikes and capped free tier at 5 RPM).
// 2.5-flash is now closed to new projects, so we're on the current 3.6-flash — still
// a thinking model, so functionCall thoughtSignatures still apply (see the chat path).
const GEMINI_MODEL = 'gemini-3.6-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// 503 = transient model overload. A couple of spaced retries usually clears it;
// kept small so it can't multiply requests-per-minute against the free-tier cap.
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
    // An exercise name is a movement only; how it's loaded is this separate field.
    // Mirror of EQUIPMENT in src/domain/types.ts (Deno can't import it).
    equipment: {
      type: 'string',
      nullable: true,
      enum: [
        'barbell',
        'dumbbell',
        'machine',
        'cable',
        'smith',
        'bodyweight',
        'kettlebell',
        'band',
        'other',
      ],
    },
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
  '  app can save them. A well-known lift is acceptable if absent.',
  '- Exercise names are MOVEMENTS and carry no equipment: use "Face Pull", not',
  '  "Cable Face Pull". Say how it is loaded in the separate `equipment` field',
  '  (barbell, dumbbell, machine, cable, smith, bodyweight, kettlebell, band,',
  '  other). Leave equipment null only if it genuinely does not matter — the app',
  "  will then infer it from the movement and the user's own history.",
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

// The conversational coach's system instruction. Unlike SYSTEM (one-shot, de-
// identified summary), this drives a multi-turn, tool-using chat over the user's
// full context. Tools execute on the client; the model only sees their results.
const CHAT_SYSTEM = [
  'You are FitNote Coach, an expert strength & conditioning coach chatting with the user inside their workout app.',
  "You are given CONTEXT: the user's profile (sex, age, experience, bodyweight, height, goal, weekly availability), recent dated training history, their saved templates, key lifts, training day/time patterns, and — if they are mid-workout — the live session.",
  '',
  'CONTEXT already contains a lot: recent dated workouts, your key lifts and best e1RMs, per-region volume, training day/time patterns, and the full list of the user\'s saved templates (names, exercises, and targets). Read it FIRST and answer directly from it whenever you can.',
  '',
  'You also have TOOLS for facts CONTEXT lacks (deeper per-lift history/trends, searching old workouts, one template in full, body-metric series). Use them sparingly — a tool round is slow.',
  '',
  'RULES:',
  '- SPEED MATTERS. Answer straight from CONTEXT when it has what you need; only call a tool for a specific missing fact. NEVER re-call a tool for data you already fetched earlier in this conversation — reuse it. Most follow-up questions need no tool at all.',
  '- Be warm, concise, and specific — talk like a knowledgeable coach, not a document. A sentence or two is usually enough.',
  '- If a request is ambiguous (goal, days available, equipment, experience), ASK one short clarifying question before committing to a plan. Never invent constraints.',
  '- Tailor everything to their sex, age, experience, bodyweight and demonstrated lifts (relative-strength framing, sensible loads, appropriate volume/progression). Never comment on appearance or weight judgmentally.',
  '- Exercise names are MOVEMENTS only and carry no equipment: use "Face Pull", not "Cable Face Pull". Equipment is a separate field.',
  "- The user's existing templates are in CONTEXT.templates — reference them by name directly. To CHANGE one, CALL proposeTemplateUpdate with its EXACT name (the session you give replaces that template's exercises).",
  '- To propose a NEW plan, CALL proposePlan (do not write the full plan as plain text — the app can only save it via the tool). Mid-workout, CALL suggestAccessories to recommend add-on work for the current session.',
  '- When advising WHEN to train, ground it in their actual day/time patterns (getTrainingPatterns).',
  '- Weights are in the user\'s unit. Use null weight to let the app seed from history; give a real number for a lift new to them.',
  '- Never give medical or injury advice; never phrase anything as certainty.',
].join('\n')

function promptFor(
  request: { kind: string; goal?: string; question?: string },
  summaryJson: string,
  libraryNames: string[],
): string {
  const context =
    `Training summary (JSON):\n${summaryJson}\n\n` +
    `Available exercises — movement names only, pair each with an \`equipment\` value:\n` +
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
// Chat drives up to MAX_TOOL_ROUNDS+1 invocations per user message, so the ceiling
// is well above the one-shot era's 8 — it bounds messages/min, not round trips.
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

// Reads payload.sub WITHOUT verifying the signature — safe only because the
// gateway already verified it (config.toml: `verify_jwt = true`, which must stay
// true or `sub` and the rate-limit key below become forgeable).
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

  // Bound the body so an authenticated client can't inflate Gemini token cost.
  // Chat carries the full context bundle + conversation, so this is larger than the
  // one-shot summary era; still small enough to cap runaway payloads.
  const MAX_BODY_BYTES = 256 * 1024
  const declaredLength = Number(req.headers.get('Content-Length') ?? '0')
  if (declaredLength > MAX_BODY_BYTES) return json({ error: 'Request too large' }, 413)

  let payload: {
    mode?: string
    summary?: unknown
    library?: unknown
    request?: { kind?: string; goal?: string; question?: string }
    contents?: unknown
    context?: unknown
    tools?: unknown
  }
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request too large' }, 413)
    payload = JSON.parse(raw)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // ── Conversational chat: a stateless relay of one Gemini round with tools. The
  // client holds the conversation and runs the tools; this only forwards. ────────
  if (payload.mode === 'chat') {
    const contents = Array.isArray(payload.contents) ? payload.contents : null
    const rawTools = Array.isArray(payload.tools) ? payload.tools : []
    if (!contents) return json({ error: 'Missing conversation' }, 400)

    // Gemini rejects a function declaration whose parameters is an OBJECT with no
    // properties ("should be non-empty for OBJECT type"). No-arg tools must omit
    // `parameters` entirely, so drop it when the properties map is empty.
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
              "\n\nCONTEXT (the user's training; JSON):\n" +
              JSON.stringify(payload.context ?? {}),
          },
        ],
      },
      contents,
      tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
      // 3.6-flash is a thinking model; unbounded thinking made every turn slow.
      // It rejects budget 0 (can't fully disable thinking), so cap it low — enough
      // to choose tools/plans, far less than the default. Raise if answers slip.
      generationConfig: { temperature: 0.6, thinkingConfig: { thinkingBudget: 128 } },
    }

    let chatRes: Response
    try {
      chatRes = await fetchGeminiWithRetry(chatBody, apiKey)
    } catch {
      return json({ error: 'Coach is unreachable' }, 502)
    }

    // Quota/overload: return a friendly assistant turn (200) rather than an error,
    // so the chat shows "resting" instead of breaking or falling back to the mock.
    // (Diagnostic: include Gemini's exact reason + status while we investigate.)
    if (chatRes.status === 429 || chatRes.status === 503) {
      let detail = ''
      try {
        const body = await chatRes.json()
        detail = String(body?.error?.message ?? '').slice(0, 400)
      } catch {
        // ignore
      }
      return json({
        kind: 'message',
        text: `⚠️ Gemini ${chatRes.status}: ${detail || 'rate limited / overloaded'}`,
      })
    }
    if (!chatRes.ok) {
      // Surface Gemini's own error message — safe, since the key travels in a
      // header, not the body — so a bad request/schema is diagnosable client-side.
      let detail = ''
      try {
        const body = await chatRes.json()
        detail = String(body?.error?.message ?? '').slice(0, 300)
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

    // Return the model's raw parts too: each functionCall carries a thoughtSignature
    // the client must echo back verbatim next turn, so it appends these as-is rather
    // than rebuilding {functionCall:{name,args}} and dropping the signature.
    if (calls.length > 0) return json({ kind: 'toolCalls', calls, modelParts: parts, text })
    return json({
      kind: 'message',
      text: text || "I'm not sure how to help with that — could you rephrase?",
    })
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
