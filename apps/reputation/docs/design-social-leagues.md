# Design — Social, Leagues & Strength Rating (backburner)

Status: **deferred / not scheduled.** This is a design to build against later, not a
committed roadmap. Captured so the decisions don't have to be re-derived.

## Why this is a real decision, not just a feature

Everything today is **local-first and private-by-default**: your data lives in
IndexedDB and syncs only to *your own* Supabase rows. Social means **cross-user
reads** — a genuine architectural shift and a new public surface on an app whose
whole pitch is "entirely yours." So the guiding rule for this entire area:

> Publish *derived numbers*, opt-in, never raw training data. Your sets, notes,
> and workouts never become visible to anyone else. Only a score does.

Everything below honours that.

## The core problem: fairness

A naive "most volume" or "biggest total" board just ranks by bodyweight and
experience — every lighter/newer lifter loses permanently and churns. Two
complementary mechanics solve this, and we should build **both** because they do
different jobs:

1. **Strength Rating** — absolute, slow-moving, *fair across bodyweight & sex*. A
   profile stat / percentile, not a weekly race.
2. **Weekly League** — activity/effort points, fast-moving, *anyone can win their
   bracket*. The retention engine.

---

## 1. Strength Rating (the "ELO", done right)

Strength is **measured**, not matched, so literal ELO (which needs head-to-head
outcomes) is the wrong tool here. Use the published, defensible normalization the
sport already trusts — **IPF GL Points** (modern successor to Wilks):

```
GLPoints = 100 × total / (A − B · e^(−C · bodyweightKg))
```

- `total` = sum of best **effective-load e1RM** on the tracked "big" lifts
  (`isKeyLift` + `bestEffectiveOneRepMaxKg` — already computed client-side).
- `A, B, C` = sex-specific constants (store the current IPF coefficient table as
  data; cite the source in a comment).

This yields one number on which a 60 kg and a 100 kg lifter genuinely compete.

**Tiers** (calibrate bands against real data once there's a population):

| Tier | GL Points | Feel |
|------|-----------|------|
| Bronze | < 50 | Just started |
| Silver | 50–75 | Consistent novice |
| Gold | 75–95 | Solid intermediate |
| Platinum | 95–110 | Advanced |
| Diamond | 110+ | Competitive |

**Present it as a percentile**, not a bare number: "stronger than 72% of lifters
at your bodyweight" motivates far more than "88.4 GL." It's a trophy, not a race
you can lose weekly.

**Fallbacks (must handle gracefully, never shame missing data):**
- No `sex` set → offer a bodyweight-relative variant (e1RM / bodyweight) or mark
  "unrated."
- No bodyweight logged → "unrated" until one exists.

**Where true ELO *does* belong:** head-to-head friend challenges (below) — there a
"win" is a real match outcome, so a per-matchup ELO that ticks up/down fits.

---

## 2. Weekly League (the retention engine — build first)

Duolingo model. Points come from **your own activity**, so it's inclusive and
privacy-light (expose a score, not workouts):

```
weekly points =
  + 10  per session logged
  + 1   per 1000 kg effective volume     (daily cap so it can't be grinded)
  + 25  per PR (any progress record type)
  + 15  weekly streak bonus (hit trainingDaysPerWeek target)
```

- ~30 similarly-active users pooled into a **bracket**.
- Weekly reset (Sunday night, using the user's `weekStartsOn`). **Top ~7 promote,
  bottom ~7 relegate.** Bronze → Diamond ladder of leagues.
- The Sunday "results" moment (promoted / held / relegated) is the hook.

Why this beats a strength board as the headline: a beginner and an elite can both
finish #1 in *their* bracket this week; it rewards the behaviour we want
(consistency), not genetics; the weekly reset is proven retention.

---

## 3. Friends & Challenges

Friend graph + head-to-head / group challenges:
- **Types:** most volume this week · most sessions · specific-lift PR race · streak
  duel (first to miss a target day loses).
- **Group workout mode:** a shared session code scopes a challenge to people
  training together.
- **ELO lives here** — each concluded challenge is a match; ratings adjust so
  rivalries stay competitive.

---

## Data model (Supabase / Postgres + RLS)

New tables, all separate from the private sync tables:

- `public_profiles(user_id pk, handle unique, display_name, avatar_url, opt_in bool default false, created_at)`
- `strength_ratings(user_id pk, gl_points, tier, bodyweight_kg, sex, computed_at)`
- `weekly_scores(user_id, week_start date, points int, breakdown jsonb, pk(user_id, week_start))`
- `leagues(id, tier, week_start)` and `league_members(league_id, user_id, points, rank, outcome)` — bracket assignment
- `friendships(a_user, b_user, status[pending|accepted], requested_by, pk(a_user,b_user))`
- `challenges(id, kind, metric, starts_at, ends_at, created_by)` and
  `challenge_participants(challenge_id, user_id, score, elo_before, elo_after)`

**RLS (the whole ballgame):**
- `public_profiles`: readable only where `opt_in = true`; writable only by owner.
- `weekly_scores` / `strength_ratings`: read your own row + rows of **accepted
  friends** + **anonymized rows in your current league bracket** (expose handle +
  points only). Write your own only.
- `friendships` / `challenge_participants`: read/write rows you're a party to.
- Raw `sets` / `workouts` / `personal_records`: **never** granted to anyone else.

**Compute on-device, submit the number.** The client already computes every
metric; it posts its weekly points / GL score. A **Supabase Postgres cron** runs
the weekly bracket assignment + promotion/relegation server-side (no client is
trusted to place itself).

**Anti-cheat:** for personal / small-beta scope, cap per-day point gains and move
on. If it ever goes public, recompute scores server-side from synced set data
rather than trusting the client-submitted number.

**Sync impact:** additive only. No change to the existing per-user sync tables or
Dexie schema beyond an opt-in flag + a cached copy of your own public profile.

---

## UX sketches

```
┌─ Gold League · ends Sun 9pm ─────────┐   ┌─ Your strength ───────────────┐
│  ↑ PROMOTION ZONE                    │   │  GOLD · 88 GL points          │
│  1  Alex        1,240 pts            │   │  Stronger than 72% at your    │
│  2  You         1,190 pts   ▲        │   │  bodyweight.                  │
│  3  Sam           980 pts            │   │  Bench 102 · Squat 150 · DL   │
│  ───────────────────────────         │   │  185  →  437 total            │
│  ↓ RELEGATION ZONE                   │   └───────────────────────────────┘
│ 28  Jordan        210 pts            │
└──────────────────────────────────────┘
```

---

## Phasing

1. **Weekly League** (best retention, inclusive, privacy-light) + the opt-in
   "Join the community" gate and `public_profiles`.
2. **Achievements / trophy case** (non-social; shares the profile surface) — see
   the non-social backlog.
3. **Strength Rating percentile** once there's a population to calibrate tiers.
4. **Friends & ELO challenges** last — only after the league proves the social
   surface earns its maintenance cost.

## Open questions

- Handle/identity: reuse the sync account email, or a separate public handle?
- Moderation surface for display names / avatars if it ever goes public.
- Does surfacing any of this on the marketing site contradict the current
  "motivation without a leaderboard" / "built out, not a roadmap" positioning?
  (Resolve before promoting it publicly.)
