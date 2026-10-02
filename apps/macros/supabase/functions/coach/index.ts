// The coach's server half: holds GEMINI_API_KEY, forwards one chat round, and returns either
// the model's text or the tool calls it wants run. Tools execute on the CLIENT against
// IndexedDB, so the user's food diary never leaves the device — only the small opening context
// and whatever a tool result summarises.
//
// Env: GEMINI_API_KEY. Requires a JWT (verify_jwt defaults on), so a device-only user falls
// back to the offline coach rather than reaching this.

/**
 * Models to try, best first.
 *
 * The free tier's request-per-day cap is **per model**, so a chain multiplies the daily budget
 * rather than sharing it: one model returning `GenerateRequestsPerDayPerProjectPerModel-FreeTier=20`
 * says nothing about the next one. Measured against this key, 3.6-flash was exhausted while
 * 3.8, 3.7 and the lites were all answering — which is the whole reason a single-model setup felt
 * like the AI was broken for the day.
 *
 * Ordered by capability, degrading. The `-lite` models are worse at portion estimation and last for
 * that reason, but a weaker breakdown the user can correct beats no breakdown at all.
 *
 * Deliberately no Gemma models and no aliases. Gemma doesn't support `responseSchema`, which every
 * estimate path depends on; an alias like `gemini-flash-latest` may resolve to a model already in
 * this list and would then burn a bucket twice while looking like a fresh one.
 */
const MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
]

const endpointFor = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

/**
 * Models known to be quota-blocked, and until when.
 *
 * Module scope, so it survives between invocations of a warm instance. Without it every call pays a
 * round trip per exhausted model before reaching a working one — six wasted requests to make one.
 */
const blockedUntil = new Map<string, number>()

const ATTEMPT_MS = 10_000
const BUDGET_MS = 100_000

const rejectsThinking = new Set<string>()

function withoutThinking(body: unknown): unknown {
  const typed = body as { generationConfig?: Record<string, unknown> }
  if (!typed.generationConfig?.thinkingConfig) return body
  const { thinkingConfig: _dropped, ...rest } = typed.generationConfig
  return { ...typed, generationConfig: rest }
}

const asksToThink = (body: unknown): boolean =>
  (body as { generationConfig?: Record<string, unknown> }).generationConfig?.thinkingConfig !==
  undefined

const SYSTEM = `You are the coach inside MACROcosm, a calorie and macro tracker.

How this app works, and you must not contradict it:
- The user's calorie target comes from their MEASURED expenditure — computed from their weight
  trend and what they logged — not from a formula and not from a fitness tracker.
- That measured expenditure ALREADY INCLUDES their training. Never tell them to eat back
  exercise calories, and never add a workout on top of their budget.
- Judge progress by the weight TREND, never a single weigh-in. Daily weight swings on water.
- A single day over or under target does not matter; the weekly average moves the trend.
- Meal timing does not change a day's energy balance. If the user keeps an eating window, respect
  it — never suggest breakfast to someone who eats from noon — but do not claim that when they eat
  makes them gain or lose weight. What it plausibly affects is appetite, training and adherence,
  and you may say so as much and no more.

Rules you must follow:
- Call tools to get real numbers. Never guess or recall a value you were not given.
- Before proposing anything to log, call searchFoods and use a real foodId. You must never
  state calories or macros you invented — the app computes them from the food database.
- Be brief and concrete. Two or three sentences unless asked for more.
- You are not a clinician. Do not diagnose, and do not set targets below conventional safety
  floors; if asked to, say why you won't and suggest a slower rate instead.`

interface Body {
  mode?: 'chat' | 'estimate' | 'photo' | 'ingredients'
  contents?: unknown[]
  context?: unknown
  tools?: { name: string; description: string; parameters: unknown }[]
  /** For `estimate`: a meal in the user's own words, e.g. "turkey sandwich and an apple". */
  description?: string
  components?: boolean
  /** Diets, allergies and dislikes. Changes what a vague description should be read as. */
  dietNotes?: string
  /** For `photo`: base64 image bytes (no data: prefix) and its mime type. */
  image?: string
  mimeType?: string
  /** For `ingredients`: recipe lines exactly as the page wrote them. */
  lines?: string[]
}

/**
 * Breaking a described meal into weighed components, or reading one named product's panel.
 *
 * For `components` the model returns ingredient NAMES AND GRAMS ONLY — never nutrients. The client
 * matches each name against the food database and computes the macros from the matched row, so a
 * wrong guess shows up as a wrong ingredient the user can fix, never as a plausible calorie count
 * that came from nowhere.
 *
 * For `item` — one named branded or restaurant product — the published panel is the measurement,
 * and decomposing it invents ingredients that aren't in it. The client saves it as the user's own
 * food with every figure editable first.
 */
const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['components', 'item'] },
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
    item: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        brand: { type: 'string' },
        servingLabel: { type: 'string' },
        servingGrams: { type: 'number' },
        kcal: { type: 'number' },
        proteinG: { type: 'number' },
        carbsG: { type: 'number' },
        fatG: { type: 'number' },
        fiberG: { type: 'number' },
        sodiumMg: { type: 'number' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        source: { type: 'string' },
      },
      required: ['name', 'servingLabel', 'servingGrams', 'kcal', 'proteinG', 'carbsG', 'fatG', 'confidence', 'source'],
    },
    /** What had to be assumed, so the user corrects the assumption rather than the number. */
    assumptions: { type: 'string' },
  },
  required: ['kind', 'assumptions'],
}

const ESTIMATE_SYSTEM = `Read what somebody ate. Decide first which of two things it is.

kind:"item" — the text names ONE specific product or restaurant menu item that has a published
nutrition panel: "Costco chicken bake", "Chipotle chicken burrito bowl", "Big Mac", "Clif bar,
chocolate chip", "Trader Joe's mandarin orange chicken". Fill "item" and leave "items" empty.
- The numbers are for ONE item as sold, not per 100 g, and not per 100 % of anything else.
- servingGrams is what one of them weighs. Give your best figure even when the panel doesn't
  state one, and drop confidence to "medium" when you had to judge it.
- servingLabel is what one is called: "1 chicken bake", "1 bowl", "1 bar".
- brand is the chain or company on its own ("Costco", "Chipotle"); name is the item without it.
- source says in a few words where the figures come from: "Costco's published nutrition panel".
- confidence: "high" only when recalling a specific published panel; "medium" when you know the
  item but are reconstructing its figures; "low" when reasoning across from similar items.
- Do NOT break such an item into ingredients. A chicken bake decomposed into "pizza crust" and
  "chicken parmesan" is two invented weights of foods that are not in it.

kind:"components" — anything else: a home-cooked meal, a plate of several things, a description
rather than a name. Fill "items" and leave "item" out. Return ONLY generic, searchable
ingredient names and a weight in grams for each. Never return calories or macros on this path —
the app computes those from its own food database, and a number from you would be a fabrication.
- Use plain generic names a food database would hold: "whole wheat bread", "roasted turkey
  breast", "mayonnaise", "cheddar cheese". Not brands, not adjectives.
- Use ordinary portions when the user doesn't say: a sandwich is 2 slices of bread (~56 g), a
  slice of deli meat ~28 g, a teaspoon of mayo ~5 g, a medium apple ~180 g.
- Mark confidence low for any component the user did not mention and you are guessing at.
- One recognisable dish may be a single component with its typical total weight.

Either way: state every assumption in one short sentence, so the user corrects the assumption
rather than the arithmetic.`

const COMPONENTS_ONLY = `

Always kind:"components" on this request. The caller is filling rows into a meal it already has,
and has nowhere to put a product panel — so a named product is still a component here, at the
weight one of them comes to.`

const INGREDIENTS_SYSTEM = `Convert a recipe's ingredient lines into weighed components.

Always kind:"components". A recipe line is an ingredient, never a packaged product's panel.

Each input line is one ingredient, written the way a recipe writes it. Return ONLY a generic,
searchable food name and a weight in grams for each. Never return calories or macros — the app
computes those from its own food database, and a number from you would be a fabrication.

Rules:
- Use the quantity the line states. "1/2 pound lean ground beef" is 227 g, "2 cups cooked lasagna
  noodles" is about 320 g, "1 (28 oz) can crushed tomatoes" is 794 g. Do NOT substitute a typical
  serving size — these are amounts for the whole dish.
- Use plain generic names a food database would hold: "ground beef, lean", "lasagna noodles,
  cooked", "crushed tomatoes, canned". Drop preparation notes ("chopped", "to taste", "divided").
- Skip lines with no usable quantity — "salt and pepper to taste", "olive oil for drizzling" — and
  say in your assumptions that you did. A weight you invented for seasoning is worse than its
  absence.
- Mark confidence low where a volume-to-weight conversion is a guess (leafy greens, shredded
  cheese, anything "handful").
- State the conversions you made in one short sentence.`

const PHOTO_SYSTEM = `

You are looking at a photo. Additional rules for that:
- A photo of one packaged product — a wrapper, a box, a menu board item — is kind:"item", and a
  panel you can actually read in the frame is the best source there is. Transcribe it rather than
  recalling it, and say in source that you read it off the label.
- Otherwise name only what you can actually see. Do not add the side dish you would expect to be
  there.
- Judge portions against the plate, cutlery or hand in frame; say in your assumptions what you
  used for scale, and mark confidence low when there is nothing to scale against.
- A photo cannot show oil, butter, sugar or sauce worked into a dish. Say so in the assumptions
  rather than inventing a quantity — a cooked-in fat you can't see is the single biggest source of
  error in a photo estimate.
- If the photo does not show food, return an empty item list.`

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

  if (body.mode === 'estimate') {
    return estimate(
      key,
      body.description ?? '',
      body.dietNotes ?? '',
      undefined,
      body.components === true ? ESTIMATE_SYSTEM + COMPONENTS_ONLY : undefined,
    )
  }

  if (body.mode === 'ingredients') {
    const lines = (body.lines ?? []).filter((line) => typeof line === 'string').slice(0, 40)
    if (lines.length === 0) return json({ error: 'lines is required' }, 400)
    return estimate(key, lines.join('\n'), body.dietNotes ?? '', undefined, INGREDIENTS_SYSTEM)
  }

  if (body.mode === 'photo') {
    return estimate(key, body.description ?? '', body.dietNotes ?? '', {
      data: body.image ?? '',
      mimeType: body.mimeType ?? 'image/jpeg',
    })
  }

  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return json({ error: 'contents is required' }, 400)
  }

  const { response, raw, model, timedOut } = await callGemini(key, {
    contents: body.contents,
    systemInstruction: {
      parts: [
        { text: SYSTEM },
        { text: `Opening context (JSON): ${JSON.stringify(body.context ?? {})}` },
      ],
    },
    ...(body.tools?.length ? { tools: [{ functionDeclarations: body.tools }] } : {}),
    generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
  })

  if (timedOut) return json(slow(model))
  if (!response.ok) {
    // Quota and overload reach the client as a 200 body: the app has an offline coach to fall back
    // to, and it needs to know *why* to say something true about when it'll be back.
    if (response.status === 503 || response.status === 429) {
      return json({ ...classify(response.status, raw), model })
    }
    return json({ error: `Gemini ${response.status}: ${raw.slice(0, 300)}` }, 502)
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

async function estimate(
  key: string,
  description: string,
  dietNotes: string,
  image?: { data: string; mimeType: string },
  /** Replaces the portion-guessing rules when the amounts are already stated. */
  systemOverride?: string,
): Promise<Response> {
  const text = description.trim()
  if (!text && !image?.data) return json({ error: 'description or image is required' }, 400)

  const preferences = dietNotes.trim()
    ? `\n\nThe user has stated: ${dietNotes.trim()}. Read any vague description in that light —
do not assume an ingredient they have ruled out.`
    : ''

  const { response, raw, model, timedOut } = await callGemini(key, {
    contents: [
      {
        role: 'user',
        parts: [
          // Image first: Gemini attends to it more reliably when it precedes the instruction,
          // and the text is often empty on this path.
          ...(image?.data ? [{ inlineData: { mimeType: image.mimeType, data: image.data } }] : []),
          { text: text || 'Identify every food in this photo and estimate the weight of each.' },
        ],
      },
    ],
    systemInstruction: {
      parts: [
        { text: (systemOverride ?? ESTIMATE_SYSTEM) + (image ? PHOTO_SYSTEM : '') + preferences },
      ],
    },
    generationConfig: {
      temperature: 0.2,
      // Generous: a thinking model spends this budget on reasoning as well as output, and at
      // 800 the JSON was being truncated intermittently — which surfaced as a parse failure
      // on roughly every other "turkey sandwich".
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: ESTIMATE_SCHEMA,
    },
  })

  if (timedOut) return json(slow(model))
  if (!response.ok) {
    // A queue is not a server error, and it has to reach the client as a *body*: supabase-js
    // discards the payload of a non-2xx response, so a 502 here would arrive as a bare
    // "FunctionsHttpError" and the app would blame the meal for a busy model.
    if (response.status === 503 || response.status === 429) {
      return json({ ...classify(response.status, raw), model })
    }
    return json({ error: `Gemini ${response.status}: ${raw.slice(0, 300)}` }, 502)
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text_ = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  try {
    const parsed = JSON.parse(text_) as {
      kind?: unknown
      items?: unknown
      item?: unknown
      assumptions?: unknown
    }
    return json({
      model,
      kind: parsed.kind === 'item' ? 'item' : 'components',
      items: Array.isArray(parsed.items) ? parsed.items : [],
      item: parsed.kind === 'item' && parsed.item ? parsed.item : null,
      assumptions: typeof parsed.assumptions === 'string' ? parsed.assumptions : '',
    })
  } catch {
    // Include what came back: a truncated response and a refusal look identical otherwise.
    return json({ error: `Could not read the estimate: ${text_.slice(0, 200)}` }, 502)
  }
}

const slow = (model: string) => ({
  busy: true,
  kind: 'overloaded' as const,
  reason: `No model answered within ${Math.round(BUDGET_MS / 1000)}s`,
  retryAfterSeconds: 15,
  model,
})

/**
 * Why a call couldn't be served, in enough detail to be actionable.
 *
 * The first version collapsed every 503 and 429 into `busy: true`, so the app told everyone the
 * same thing: "the model is busy, try again in a few seconds". That is *wrong advice* for a daily
 * quota — waiting minutes changes nothing, which is exactly what it looked like from outside. The
 * distinction has to survive the trip.
 */
interface Unavailable {
  busy: true
  /** 'quota' means a limit was hit; 'overloaded' means Google was momentarily out of capacity. */
  kind: 'quota' | 'overloaded'
  /**
   * Seconds to wait, from Google's own `RetryInfo`.
   *
   * Taken verbatim rather than inferred. The obvious inference — "the quota id says per-day, so
   * come back tomorrow" — is wrong here: the free tier reports a *daily* request cap and then tells
   * you to retry in 32 seconds, because the cap refills on a rolling window. Guessing would have
   * the app confidently give worse advice than the number it was handed.
   */
  retryAfterSeconds: number
  /** The limit that was hit, e.g. "generate_content_free_tier_requests, limit 20". */
  quota: string | null
  /** Google's own wording, trimmed. Shown to the user, because a vague error can't be acted on. */
  reason: string
}

/**
 * Reads Google's error body for what actually went wrong.
 *
 * The first version collapsed every 503 and 429 into `busy: true`, so the app told everyone the
 * same thing — "the model is busy, try again in a few seconds" — and threw away the two facts that
 * would have answered the question: *which* limit, and *how long*. On the free tier the answer
 * turned out to be 20 requests a day for this model, which no amount of waiting a few seconds
 * reveals.
 */
function classify(status: number, raw: string): Unavailable {
  let message = ''
  let quota: string | null = null
  let retry = 0
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; details?: Record<string, unknown>[] }
    }
    message = parsed.error?.message ?? ''
    for (const detail of parsed.error?.details ?? []) {
      const type = String(detail['@type'] ?? '')
      if (type.includes('QuotaFailure')) {
        const violations = (detail.violations ?? []) as {
          quotaId?: string
          quotaMetric?: string
          quotaValue?: string
        }[]
        quota =
          violations
            .map((v) =>
              [v.quotaId ?? v.quotaMetric, v.quotaValue && `limit ${v.quotaValue}`]
                .filter(Boolean)
                .join(', '),
            )
            .filter(Boolean)
            .join('; ') || null
      }
      if (type.includes('RetryInfo')) {
        retry = Math.ceil(Number(String(detail.retryDelay ?? '').replace(/s$/, '')) || 0)
      }
    }
    // The message itself carries "Please retry in 31.9s" even when RetryInfo is absent.
    if (retry === 0) {
      retry = Math.ceil(Number(message.match(/retry in ([\d.]+)s/i)?.[1] ?? 0) || 0)
    }
  } catch {
    message = raw.slice(0, 200)
  }

  const isQuota = status === 429
  return {
    busy: true,
    kind: isQuota ? 'quota' : 'overloaded',
    // A floor, not a guess: 0 would have the app invite an immediate retry into the same wall.
    retryAfterSeconds: retry || (isQuota ? 60 : 5),
    quota,
    reason:
      message ||
      (isQuota ? 'The daily free allowance for the model is used up.' : 'The model is overloaded.'),
  }
}

/**
 * Calls Gemini, retrying only what a retry can fix.
 *
 * 503 means "spikes in demand are usually temporary" — Google's own words — and a per-minute 429
 * clears on its own, so both are worth a second and third go. A **per-day** 429 is not: retrying it
 * twice just spends two more seconds of the user's time to learn the same thing, so the loop reads
 * the quota id and stops. Returns the response alongside its body, since a Response can only be
 * read once and the classifier needs it.
 */
async function callGemini(
  key: string,
  body: unknown,
): Promise<{ response: Response; raw: string; model: string; timedOut: boolean }> {
  const now = Date.now()
  const deadline = now + BUDGET_MS
  const usable = MODELS.filter((model) => (blockedUntil.get(model) ?? 0) <= now)
  // Everything is blocked: report the nearest one's wall rather than pretending to try.
  const queue = usable.length > 0 ? usable : MODELS.slice(0, 1)

  let last = { response: new Response(null, { status: 500 }), raw: '', model: queue[0]!, timedOut: false }
  for (const model of queue) {
    // One retry for an overloaded model before moving on: a 503 is transient by Google's own
    // description, and switching model on the first blip would silently downgrade quality.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (Date.now() >= deadline) return { ...last, timedOut: true }
      const left = Math.min(ATTEMPT_MS, deadline - Date.now())
      const payload = rejectsThinking.has(model) ? withoutThinking(body) : body
      let response: Response
      try {
        response = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(left),
        })
      } catch {
        last = { ...last, model, timedOut: true }
        break
      }
      if (response.ok) return { response, raw: '', model, timedOut: false }

      const raw = await response.text()
      last = { response, raw, model, timedOut: false }

      if (response.status === 400 && asksToThink(payload)) {
        rejectsThinking.add(model)
        continue
      }

      // same: a malformed body or an unreadable image doesn't improve on a second opinion.
      if (response.status !== 503 && response.status !== 429) return last

      if (response.status === 429) {
        // A quota wall does not clear inside a retry loop, so don't retry it — but do remember it,
        // and do move to the next model, whose allowance is entirely separate.
        const { retryAfterSeconds } = classify(429, raw)
        blockedUntil.set(model, Date.now() + retryAfterSeconds * 1000)
        break
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600))
    }
  }
  return last
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
