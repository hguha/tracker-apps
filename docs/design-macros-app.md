# Design — MACROcosm

**Status: plan, nothing built.** Replace with a roadmap once it ships.

A calorie/macro tracker with MacroFactor's adaptive-expenditure engine and a Cookwell-style
recipe/meal builder, on the existing tracker-engine. Internal id stays **`macros`**
(`apps/macros`, Dexie db `macros`, storage key `macros.auth`, scheme `macros://auth-callback`),
per the convention where REPutation stays `fitnote` and COINcidence stays `ledger`.

---

## 1. The thesis

Most trackers ask you to pick a calorie target from a formula and then never revisit it.
MacroFactor's insight is that **your expenditure is measurable from data you already have** —
weight trend plus logged intake — and is more accurate than any formula or wearable estimate.
That algorithm is the product. Everything else is logging speed.

Two consequences that shape the whole design:

- **Weight and intake are the primary instruments.** Adherence matters only because gaps
  degrade the estimate; the app should never scold, it should widen its error bars.
- **Activity data does not set the target.** REPutation tells us *why* expenditure moved and
  lets us cycle calories across training and rest days, but the level comes from the
  algorithm. This is the opposite of a fitness-tracker integration that adds "calories
  burned" to your budget — that double-counts, because a measured TDEE already includes
  training.

---

## 2. Domain model

`SyncColumns` (`id`, `userId`, `createdAt`, `updatedAt`, `deletedAt`, `clientRev`) is the
engine's existing base; every synced interface extends it.

### Reference data (server-authored, pull-only)

```ts
/** A food from USDA FDC or Open Food Facts. Never edited by a client. */
export interface Food extends SyncColumns {
  id: string                     // `usda:${fdcId}` | `off:${barcode}`
  source: FoodSource             // 'usda' | 'off'
  description: string
  brand: string | null
  barcode: string | null         // gtinUpc
  category: string | null
  /** Per 100 g/ml, the canonical basis for all arithmetic. */
  per100: Nutrients
  /** Density, for volume→mass when a portion is measured in ml. */
  gramsPerMl: number | null
  portions: FoodPortion[]        // embedded; never separately synced
  /** FDC data type, e.g. 'foundation' | 'sr_legacy' | 'branded' | 'survey'. */
  dataType: string | null
  verifiedAt: number | null
}

export interface FoodPortion {
  id: string
  label: string                  // "medium (3\" dia)", "1 cup, chopped", "1 slice"
  grams: number
  isDefault: boolean
}

/** Integers in the unit named by the field. Nulls mean unknown, never zero. */
export interface Nutrients {
  kcal: number
  proteinMg: number
  carbsMg: number
  fatMg: number
  fiberMg: number | null
  sugarMg: number | null
  addedSugarMg: number | null
  satFatMg: number | null
  transFatMg: number | null
  sodiumMg: number | null
  potassiumMg: number | null
  cholesterolMg: number | null
  calciumMg: number | null
  ironMg: number | null
  vitaminAMcg: number | null
  vitaminCMg: number | null
  vitaminDMcg: number | null
}
```

**Why milligrams.** Macros in grams as floats reintroduce exactly the drift the workout app
fixed by storing kg canonically and money by storing minor units. `proteinMg: 31_400` is
31.4 g with no float in the sum. `kcal` stays an integer — sub-calorie precision is noise.

### User data (client-authored)

```ts
/** One food, recipe, or quick-add eaten at a time. The app's central row. */
export interface LogEntry extends SyncColumns {
  id: string
  userId: string
  /** Local calendar day, `yyyy-MM-dd`. Denormalized so day queries are one index hit. */
  day: string
  eatenAt: number
  meal: MealSlot                 // 'breakfast' | 'lunch' | 'dinner' | 'snack'
  sortIndex: number

  /** Exactly one of these three is set. */
  foodId: string | null
  recipeId: string | null
  quickAdd: Nutrients | null

  /** How much: grams is canonical; portion is what the user picked, kept for display. */
  grams: number
  portionId: string | null
  portionCount: number | null

  /** Resolved at write time so history can't be rewritten by a reference-data update. */
  nutrients: Nutrients
  source: EntrySource            // 'search' | 'barcode' | 'photo' | 'recipe' | 'quick' | 'copy'
  /** Photo/AI provenance. null for anything the user picked explicitly. */
  estimate: EstimateMeta | null
}

export interface EstimateMeta {
  confidence: 'high' | 'medium' | 'low'
  /** What the model said before matching, kept so a bad match is diagnosable. */
  rawLabel: string
  photoId: string | null
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
}

/** A weigh-in. Owned by @tracker-engine/body and shared with REPutation (§6). */
export interface BodyWeight extends SyncColumns {
  id: string
  userId: string
  day: string
  kg: number
  source: 'macros' | 'reputation' | 'import'
}

export interface Recipe extends SyncColumns {
  id: string
  name: string
  servings: number
  /** Cooked yield in grams. Lets a portion be "150 g of the finished dish". */
  yieldGrams: number | null
  ingredients: RecipeIngredient[]   // embedded
  steps: string[]
  tags: string[]
  sourceUrl: string | null
  authoredBy: 'user' | 'ai'
  /** Denormalized total for the whole recipe; per-serving is derived. */
  nutrients: Nutrients
}

export interface RecipeIngredient {
  id: string
  foodId: string | null
  /** Free text when unmatched, so a recipe is never blocked by a missing food. */
  label: string
  grams: number
  portionId: string | null
  portionCount: number | null
  optional: boolean
}

/** A named group of entries — "usual breakfast" — inserted in one tap. */
export interface MealTemplate extends SyncColumns {
  id: string
  name: string
  items: MealTemplateItem[]
  nutrients: Nutrients
}

/** The program: what you're trying to do to your bodyweight and how fast. */
export interface Program extends SyncColumns {
  id: string
  goal: 'lose' | 'gain' | 'maintain'
  /** Signed %/week of bodyweight. −0.5 = lose half a percent per week. */
  ratePctPerWeek: number
  startedAt: number
  endedAt: number | null
  coachingMode: 'coached' | 'collaborative' | 'manual'
  /** Grams per kg bodyweight; the floor the macro split is built around. */
  proteinGPerKg: number
  fatMinPctKcal: number
  /** Optional day-of-week multipliers for calorie cycling (§6.3). */
  cycling: CyclingConfig | null
}

/** One weekly recalculation. Immutable audit trail — never updated in place. */
export interface CheckIn extends SyncColumns {
  id: string
  weekStart: string               // yyyy-MM-dd
  /** What the algorithm concluded. */
  expenditureKcal: number
  expenditureSe: number           // standard error, drives the confidence band
  trendKg: number
  trendChangeKgPerWeek: number
  meanIntakeKcal: number
  daysLogged: number
  /** The targets it produced. */
  targets: MacroTargets
  /** 'coached' applies automatically; 'collaborative' waits. */
  status: 'applied' | 'proposed' | 'declined'
  note: string
}

export interface MacroTargets {
  kcal: number
  proteinMg: number
  carbsMg: number
  fatMg: number
}

/** Device-local, never synced: units, theme, onboarding state, the REPutation link. */
export interface Profile { /* … */ }
```

---

## 3. The expenditure algorithm

This is the piece worth getting right. `lib/expenditure.ts`, pure, unit-tested against
fixtures.

**Step 1 — weight trend.** Daily weights are noisy (±1–2 kg from water and gut content), so
decisions use a smoothed trend, not the raw scale. Exponentially weighted moving average with
a ~10-day half-life:

```
trend[0] = weight[0]
trend[i] = trend[i-1] + α · (weight[i] − trend[i-1]),  α = 1 − 2^(−1/10)
```

Gaps are interpolated, not carried forward, so a week away doesn't flatten the trend.

**Step 2 — energy balance.** Over a window, the trend change implies a net balance:

```
ΔE = Δtrend_kg · k
```

`k` is the energy density of tissue change, and it is **not** the folk 7700 kcal/kg. Use
~7700 for fat loss/gain, but lean gain is ~1800 kcal/kg, so `k` is interpolated by the
program's goal and rate — an aggressive surplus deposits proportionally more lean mass. Store
the constant used in the check-in so a later change doesn't silently rewrite history.

**Step 3 — expenditure.**

```
TDEE = mean_intake_kcal − ΔE / days
```

**Step 4 — filter.** A single window is too noisy to act on, so run a Kalman-style update
over successive windows: state is `[TDEE, drift]`, measurement is the window estimate, and
the measurement variance rises with fewer logged days and with weight variance. This is what
makes the estimate settle instead of oscillating, and it yields `expenditureSe` for free — the
number the UI shows as a confidence band. **Never present a point estimate without it.**

**Step 5 — targets.**

```
target_kcal = TDEE + ratePctPerWeek/100 · trend_kg · k / 7
protein_g   = proteinGPerKg · trend_kg           (floor)
fat_g       = max(fatMinPctKcal% of target_kcal, …) (floor)
carbs_g     = remainder
```

**Cold start.** With no history, seed from Mifflin-St Jeor × an activity factor, and if
REPutation is connected, take the activity factor from measured training frequency instead of
asking. Mark the first ~14 days as `low` confidence and adjust conservatively; the formula is
a prior the data overwrites, not an answer.

**Guardrails.** Cap week-to-week target movement (~±150 kcal), require ≥4 logged days and ≥3
weigh-ins to move at all, and refuse to run on a week with an obvious outlier (a 3 kg
overnight jump) — flag it for the user rather than absorbing it.

---

## 4. Nutrition arithmetic

`lib/nutrition.ts` is the canonical layer, the exact role `lib/metrics.ts` plays in
REPutation. Add it to `scripts/check-architecture.mjs` so nothing else can do this maths —
the same rule that stopped the coach and the home screen disagreeing about volume.

```ts
export function gramsOf(portion: FoodPortion, count: number): number
export function nutrientsFor(food: Food, grams: number): Nutrients
export function scale(n: Nutrients, factor: number): Nutrients
export function sum(items: readonly Nutrients[]): Nutrients
export function recipeNutrients(r: Recipe, foods: Map<string, Food>): Nutrients
export function perServing(r: Recipe): Nutrients
export function dayTotals(entries: readonly LogEntry[]): Nutrients
export function remaining(totals: Nutrients, targets: MacroTargets): MacroTargets
export function kcalFromMacros(n: Nutrients): number      // 4/4/9, for cross-checking
export function macroSplitPct(n: Nutrients): { p: number; c: number; f: number }
```

`sum` and `scale` operate on integer mg with one rounding step at the end, so a day's total
never drifts from the sum of its rows.

---

## 5. Infrastructure

### Supabase

**Own project** (`macros`), with REPutation reached over an explicit link (§6) rather than a
shared database. This reverses my earlier recommendation, and the user's framing is the reason:
a **"Connect REPutation account"** button is a feature, not a workaround. It keeps each app
independently deployable, keeps the blast radius of a bad migration to one app, and means the
integration works the same way a third-party one would — which is what makes it honest about
consent.

### Migrations

`0001_schema.sql`, `0002_rls.sql`, `0003_link.sql`, `0004_foods.sql`.

Conventions inherited exactly from COINcidence: `user_id uuid not null default auth.uid()
references auth.users(id) on delete cascade` so the client never sends an owner;
`set_row_timestamps()` trigger so the server clock owns `created_at`/`updated_at` and a device
with a wrong clock can't poison delta-pull ordering; `deleted_at` for tombstones;
`client_rev integer not null default 1`; text ids generated client-side.

```sql
-- 0001_schema.sql (abridged: every table also has the standard sync columns)

-- Server-authored reference data. No user_id: foods are global, not owned.
create table foods (
  id            text primary key,               -- 'usda:1750340' | 'off:0038000138416'
  source        text not null check (source in ('usda','off')),
  description   text not null,
  brand         text,
  barcode       text,
  category      text,
  data_type     text,
  per100        jsonb not null,                 -- Nutrients
  grams_per_ml  numeric,
  portions      jsonb not null default '[]',
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index foods_barcode_idx  on foods (barcode) where barcode is not null;
create index foods_search_idx   on foods using gin (to_tsvector('english', description || ' ' || coalesce(brand,'')));

create table log_entries (
  id            text primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day           text not null,
  eaten_at      timestamptz not null,
  meal          text not null default 'snack',
  sort_index    integer not null default 0,
  food_id       text,
  recipe_id     text,
  quick_add     jsonb,
  grams         numeric not null default 0,
  portion_id    text,
  portion_count numeric,
  nutrients     jsonb not null,
  source        text not null default 'search',
  estimate      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  client_rev    integer not null default 1,
  constraint one_subject check (
    (food_id is not null)::int + (recipe_id is not null)::int + (quick_add is not null)::int = 1
  )
);
create index log_entries_day_idx on log_entries (user_id, day) where deleted_at is null;

create table body_weights (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day        text not null,
  kg         numeric not null,
  source     text not null default 'macros',
  -- …sync columns
  unique (user_id, day)
);

create table recipes ( id text primary key, user_id uuid …, name text not null,
  servings integer not null default 1, yield_grams numeric,
  ingredients jsonb not null default '[]', steps jsonb not null default '[]',
  tags jsonb not null default '[]', source_url text,
  authored_by text not null default 'user', nutrients jsonb not null, … );

create table meal_templates ( … items jsonb not null default '[]', nutrients jsonb not null, … );
create table programs   ( … goal text not null, rate_pct_per_week numeric not null,
                          coaching_mode text not null default 'coached',
                          protein_g_per_kg numeric not null default 1.8,
                          fat_min_pct_kcal numeric not null default 20,
                          cycling jsonb, started_at timestamptz not null, ended_at timestamptz, … );
create table check_ins  ( … week_start text not null, expenditure_kcal numeric not null,
                          expenditure_se numeric not null, trend_kg numeric not null,
                          trend_change_kg_per_week numeric not null,
                          mean_intake_kcal numeric not null, days_logged integer not null,
                          targets jsonb not null, status text not null, note text not null default '',
                          unique (user_id, week_start) );
```

```sql
-- 0002_rls.sql
alter table log_entries    enable row level security;
alter table body_weights   enable row level security;
alter table recipes        enable row level security;
alter table meal_templates enable row level security;
alter table programs       enable row level security;
alter table check_ins      enable row level security;
alter table foods          enable row level security;

-- Client-authored: full ownership.
create policy "own log_entries" on log_entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- …identical for body_weights, recipes, meal_templates, programs, check_ins

-- Reference data: everyone reads, nobody writes. The `foods` function (service role)
-- upserts; with no write policy those statements are denied for any normal user, so a
-- client can never forge a food row and corrupt someone else's history.
create policy "read foods" on foods for select using (true);
```

### Dexie

```ts
db.version(1).stores({
  foods:         'id, barcode, description, source',
  logEntries:    'id, day, [day+meal], eatenAt, foodId, recipeId',
  bodyWeights:   'id, day',
  recipes:       'id, name, *tags',
  mealTemplates: 'id, name',
  programs:      'id, startedAt',
  checkIns:      'id, weekStart',
  profile:       'id',
  // engine-owned
  outbox:        '++seq, table, rowId, [table+rowId]',
  deadLetter:    '++seq, table, rowId',
  syncState:     'table',
})
```

### Sync schema

```ts
export const macroSyncSchema: SyncSchema = {
  // Parents before children: a log entry may reference a recipe.
  tables: ['programs', 'recipes', 'mealTemplates', 'bodyWeights', 'logEntries', 'checkIns', 'foods'],
  serverAuthored: ['foods'],
  parentIdOf: (table, row) =>
    table === 'logEntries' ? ((row.recipeId as string | null) ?? undefined) : undefined,
  normalize: (table, row) =>
    table === 'recipes' ? { ...row, ingredients: row.ingredients ?? [], steps: row.steps ?? [] } : row,
  store: (table) => storeFor(table),
  eraseOrder: ['logEntries', 'checkIns', 'bodyWeights', 'mealTemplates', 'recipes', 'programs'],
}
```

`foods` is server-authored and excluded from `eraseOrder` — it's shared reference data that
must survive an account wipe. Same shape as COINcidence's bank feed, which is why the
abstraction already exists.

### Edge functions

| Function | Contract | Notes |
|---|---|---|
| `foods` | `{op:'search', q, limit}` → `{foods: Food[]}`; `{op:'barcode', code}` → `{food: Food \| null}`; `{op:'get', id}` | Keeps the USDA key server-side. USDA first, Open Food Facts fallback, upserts into `foods` so the second lookup is local |
| `vision` | `{imageBase64, hint?}` → `{items: {label, grams, confidence}[]}` | Gemini multimodal. **Returns items and quantities only — never nutrient numbers** |
| `coach` | `{messages, context}` → streamed text + tool calls | `runToolLoop` from `@tracker-engine/ai-coach`; echo `thoughtSignature` verbatim |
| `recipe` | `{prompt, constraints:{kcal, proteinMg, …}, pantry?}` → `{recipe: Recipe}` | Ingredients + steps only; macros computed client-side from matched foods |
| `checkin` | cron, weekly | Runs the algorithm server-side for users with push enabled; the client recomputes identically and offline |
| `delete-account` | — | Lift REPutation's verbatim |
| `keepalive` | cron | Supabase free tier pauses after 7 days idle |

**Deploy every function to the project before debugging client code.** `delete-account` was
missing from REPutation's project for months and 404'd silently.

### Food data pipeline

`scripts/build-food-seed.mjs` pulls the FDC bulk download and emits a curated subset
(~8–10k common foods: Foundation, SR Legacy, Survey, plus the highest-frequency branded
items) as a compressed JSON asset seeded into IndexedDB on first run — the same approach as
REPutation's 1,292-line exercise seed. Result: instant offline search for the foods people
actually eat, with the network only for the long tail and barcodes.

---

## 6. Connecting REPutation

An explicit, revocable, opt-in link. Consent is the point, so it's modelled as one.

### Flow

1. Settings → **Connect REPutation** → deep-links to REPutation
   (`fitnote://link?app=macros&challenge=…`), or a web handoff if it isn't installed.
2. REPutation shows what will be shared, in plain words, and on approval calls its own
   `issue-link-grant` function.
3. That mints a **grant** row in REPutation's project: a random opaque token, the scopes, and
   an expiry. Returns via `macros://auth-callback?grant=…`.
4. MACROcosm stores the token in its device-local profile and calls REPutation's
   `training-summary` function with it.
5. Either side can revoke; MACROcosm shows last-sync time and exactly what came across.

```sql
-- in REPUTATION's project
create table link_grants (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  app         text not null,                    -- 'macros'
  token_hash  text not null,                    -- sha256; the raw token is never stored
  scopes      text[] not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  last_used_at timestamptz
);
alter table link_grants enable row level security;
-- Owner may see and revoke their grants; only the service role validates a token.
create policy "own grants" on link_grants for select using (user_id = auth.uid());
create policy "revoke own grants" on link_grants for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Store `token_hash`, not the token, so a dump of this table can't be replayed. RLS has **no
insert policy** — grants are minted only by the edge function under service role, the same
deny-all-to-clients shape as COINcidence's `plaid_items`.

### What crosses, and what doesn't

`training-summary` returns **derived numbers only**. No sets, no notes, no exercise history —
the same rule the social/leagues design settled on.

```ts
// GET /functions/v1/training-summary   Authorization: Bearer <grant token>
interface TrainingSummary {
  generatedAt: number
  weeks: {
    weekStart: string
    sessions: number
    /** Sum of duration × MET-derived intensity. The only "burn" number, and it is
     *  never added to the calorie budget — see §1. */
    trainingKcal: number
    setsHard: number
    minutes: number
    avgRpe: number | null
  }[]
  days: { day: string; trained: boolean; trainingKcal: number }[]
  bodyWeights: { day: string; kg: number }[]
  latest: { bodyweightKg: number | null; goal: string | null }
}
```

### Bodyweight

The genuine two-way case: you weigh yourself in whichever app you happen to open. Both apps
keep their own row and reconcile by `(userId, day)` with `source` recorded, last-write-wins on
`updatedAt` — the engine's existing rule. The shared domain and the reconcile function live in
a new **`@tracker-engine/body`** package so neither app owns the definition, and so the third
app inherits it. Duplicated storage is acceptable here; a duplicated *definition* is not.

### What connection actually buys

1. **A better cold start** — activity factor from measured training frequency, so the first
   two weeks aren't a guess.
2. **Calorie cycling** — the weekly target is fixed by the algorithm, but distributed across
   days by training load: more carbs on a squat day, fewer on a rest day, same weekly total.
   `Program.cycling` holds the multipliers.
3. **Protein from real bodyweight**, updated as the trend moves, not typed once at signup.
4. **Explained variance** — "expenditure is up 180 kcal; you trained 5× instead of 3×" turns
   a mysterious number into a legible one.
5. **Back to REPutation** — yesterday's calories and protein, so its coach can distinguish
   under-recovering from under-eating.

---

## 7. Screens

| Screen | Contents |
|---|---|
| **Today** | Calorie ring + macro bars vs target, remaining (paced against an eating window if there is one), the day as **eating occasions with times** rather than four fixed meal boxes, weigh-in prompt, weight/BMI projection, diet completeness, badges |
| **Log** | A screen, not a sheet. One input that either searches or breaks the text down as a meal; meal + full datetime always visible; barcode · **photo** · quick-add in the action row; tabs for Suggested · Eat again · Frequent · Saved, with a preview before anything is written (at ½–2×) |
| **Food detail** | Portion picker, per-portion macros, micronutrients, source badge (`USDA` / `OFF` / `estimate`) |
| **Recipes** | Built by describing the dish or searching ingredient by ingredient; live per-serving macros; logged a serving (or half, or two) at a time |
| **Your foods** | A food from its label, per 100 g with the stated serving as a portion. Offered on an empty search or an unknown barcode |
| **Bowl builder** | Cookwell-style component picker (base / protein / veg / sauce / topping) that assembles a meal to hit a macro gap |
| **Trends** | Weight (raw + trend), expenditure with its confidence band, intake vs target, adherence |
| **Check-in** | This week's numbers, the proposed targets, and *why* — accept/adjust in collaborative mode |
| **Coach** | Chat with tools over the user's own data; meal ideas; "what can I make with what's in my kitchen" |
| **Settings** | Account first, then a list of destinations: coach, saved meals, badges · targets & goal (coaching mode, **calorie cycling**), weekly check-in (explains the method, forces a run), about you, food & units (diet notes, **eating window**), appearance · data & sync, **Connect REPutation** |
| **Insights** | Five sub-tabs (Overview · Intake · Body · Habits · Nutrients) over one range filter, fourteen charts |

Reuses as-is from the engine: `Button`, `Card`, `ProgressRing`, `PillSelect`, `BottomSheet`,
`Toast`, `SwipeableRow`, `DragList`, `ErrorBoundary`, appearance/theming, the whole auth
lifecycle, sync status UI, backup/export, badges.

---

## 8. Phases

1. **Log + Today.** Seeded food DB, search, portions, quick-add, day totals, manual targets.
   Useful on its own; nothing after this is required.
2. **Weight + algorithm.** Weigh-ins, trend, expenditure filter, weekly check-in, the three
   coaching modes. This is the differentiator — do it early.
3. **Barcode + remote lookup.** ML Kit native, `BarcodeDetector` + `@zxing/library` WASM on
   web (iOS Safari has historically lacked it, so the fallback is required), `foods` function.
4. **REPutation link.** Grants, `training-summary`, `@tracker-engine/body`, cold start,
   cycling.
5. **Recipes + bowl builder + coach.** Computed macros, shopping lists, constrained AI
   generation.
6. **Breadth.** Micronutrient targets, fibre/sodium goals, meal timing and eating windows,
   calorie cycling, water, refeeds and diet breaks, maintenance phases, badges, CSV export.

## 9. Not doing

- **Meal-plan delivery or grocery ordering** — commerce, not tracking.
- **Restaurant menu licensing** — the good databases are paid; branded + photo covers most.
- **Wearable "calories burned" added to the budget** — double-counts a measured TDEE (§1).
- **Medical or clinical claims.** Targets are informational, and the app should say so —
  worth checking against App Store guideline 1.4.1 before submission, and worth refusing to
  set targets below conventional safety floors.

## 10. Free-tier watchpoints

- **USDA FDC**: 1,000 req/hr per key (3,600 with a data.gov key). The seeded subset keeps
  normal use off the API entirely.
- **Open Food Facts**: free and open, but crowd-sourced — always lower confidence than USDA,
  and shown as such.
- **Gemini**: rate-limited; photo and coach paths must degrade gracefully, as REPutation's
  coach already does.
- **Supabase free**: 500 MB, pauses after 7 days idle. Foods live in IndexedDB, not Postgres;
  only user rows are stored server-side. Keep-alive cron required.
