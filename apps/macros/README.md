# MACROcosm

Local-first calorie and macro tracker on the shared `@tracker-engine/*` packages.
Internal id is `macros` (Dexie db, `macros.auth`, `macros://auth-callback`); the
user-facing name is MACROcosm.

Design and roadmap: `docs/design-macros-app.md` at the repo root.

## What's built

- **Today** — calorie ring and macro bars against target, meals, weigh-in.
- **Log** — offline search over seeded foods, portions, servings-or-grams, quick add.
- **History** — 30 days of totals against target, one-tap copy of a day.
- **Insights** — measured expenditure with its error bar, calories vs target, weight trend
  with each weigh-in behind it, macro grams per day, and every past check-in.
- **Coach** — chat that reads your own logs by tool call; anything it proposes logging comes
  back as a card you confirm. Falls back to an offline coach with no key or no session.
- **Settings** — goal and rate, the cold-start facts, appearance, account, data & sync.
- `lib/nutrition.ts` — the only place nutrient arithmetic happens (enforced by
  `npm run lint`).
- `lib/expenditure.ts` — TDEE measured from weight trend and intake, not predicted.

## Not built yet

Photo logging, recipes and the bowl builder, and the REPutation link. See the design doc's
phases.

## Commands

```
npm run dev --workspace macros
npm run test --workspace macros
npm run lint --workspace macros     # layering + calc-consistency
```

## Nutrients are integer milligrams

`proteinMg: 31_400` is 31.4 g. Floats in grams reintroduce the drift REPutation fixed by
storing kg canonically and COINcidence by storing minor units — a day's total has to equal
the sum of its rows. `kcal` is an integer; sub-calorie precision is noise.
