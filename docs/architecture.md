# Architecture: many apps, one engine

How a growing family of small local-first apps (workout, expense, calorie, …) shares a
foundation without becoming one unmaintainable monolith — and without paying the polyrepo tax
before it's earned. The shared foundation is the **`tracker-engine`** repo, published as the
`@tracker-engine/*` scope.

## The two models, honestly

**Monorepo** — one repo, `packages/*` (the engine) + `apps/*`. Packages are consumed *from
source* via workspace symlinks; the app's bundler (Vite) compiles them as if they were local
folders.
- ✅ Atomic changes across engine + app in one commit; no publish step; instant iteration.
- ❌ Couples release cadence; one repo accumulates every unrelated app; CI runs everything.

**Polyrepo** — `tracker-engine` is its own repo that *publishes* versioned `@tracker-engine/*`
packages; each app is its own repo depending on a pinned version.
- ✅ Independent release cadence; small, focused repos; clean ownership; an app pins an engine
  version and upgrades on its own schedule.
- ❌ The engine must be **built and published** (not consumed from source); a cross-cutting
  change spans repos (edit engine → publish → bump app); more moving parts.

Neither is "correct" — they're right at different times. The plan is to **start monorepo and
graduate to polyrepo** when the second app has hardened the engine and the repo genuinely wants
to split.

## The one mechanic that dictates everything: how the engine is consumed

In a **monorepo**, Vite treats a symlinked workspace package as part of the source graph and
transpiles its TypeScript directly. That's why our packages can point `exports` straight at
`./src/index.ts` with **no build step** ("resolve-to-source"). It's the cheapest possible loop.

Across **repos**, an app installs `@tracker-engine/*` into `node_modules`, and bundlers/`tsc`
do **not** transpile `node_modules` by default. So a cross-repo engine must ship **compiled
JavaScript + `.d.ts` type declarations**, not raw `.ts`. That single fact is the whole cost of
going polyrepo: the engine gains a build (`tsc` emit) and a publish step.

Consequence: don't split repos until the engine is stable enough that a build+publish loop is
worth it. Until then, symlinked source is strictly better.

## Publishing the engine (when we get there)

Options, simplest-that-works first:

1. **GitHub Packages (private npm registry)** — publish `@tracker-engine/*` to GitHub; each app
   adds an `.npmrc` routing the `@tracker-engine:` scope to GitHub and authenticates with a
   token. Versioned, private, free within limits, integrates with the existing GitHub setup.
   **← recommended.**
2. **Git dependencies on tagged releases** — `"@tracker-engine/core": "github:<org>/tracker-engine#core-v1.2.0"`
   with a `prepare` build so the tag ships `dist/`. No registry, but tagging/versioning several
   packages from one repo is fiddly. Fine as a stopgap.
3. **npm paid private / self-hosted Verdaccio** — overkill for a solo dev.

**Versioning:** semver per package, managed with **Changesets** in the `tracker-engine` repo —
it batches version bumps + changelogs + publish. Apps pin `^1.x` and upgrade deliberately.

## Target layout

```
~/tracker-apps/              local workspace + the handbook (its own small docs repo)
├── README.md                shared philosophy
├── docs/                    cross-cutting design (this file, migration notes, decisions)
│
├── tracker-engine/          → own repo; publishes @tracker-engine/* (GitHub Packages)
│   ├── packages/
│   │   ├── core/            cn, money, dates, units, palette, theme
│   │   ├── local-first/     sync engine + Dexie scaffolding + Supabase backend
│   │   ├── auth/            providers + AuthContext + supabase client
│   │   ├── platform/        Capacitor wrappers
│   │   ├── ui/              component kit + Tailwind preset
│   │   └── ai-coach/        chat shell + provider interface + mock
│   ├── .changeset/          version management
│   └── .github/workflows/   build + test + publish on tag
│
├── reputation/              → own repo — workout tracker (today: ~/workout-tracker)
├── reputation-site/         → own repo — Astro marketing (today: ~/fitnote-site → reputation.fitness)
├── ledger/                  → own repo — expense tracker (future)
├── ledger-site/             → own repo — Astro marketing (future)
└── calorie/  calorie-site/  → future
```

**An app repo** (`reputation`, `ledger`, …): `src/{domain,db,data,features,app}` + `sync/`
(its `SyncSchema` + `SyncDeps` + a thin engine subclass) + Capacitor config + `ios/`/`android/`
+ Fastlane + Vercel/PWA. `package.json` depends on pinned `@tracker-engine/*`.

**A site repo** (`*-site`): Astro marketing (the `fitnote-site` pattern), its own Vercel project
+ domain. A future `@tracker-engine/site-kit` could share Astro components/design tokens across
sites — speculative; add only if the sites start duplicating.

## Migration sequence (don't skip ahead)

**Phase A — now (monorepo, one app).** Engine + REPutation in one repo; resolve-to-source; the
engine is carved out package-by-package behind green tests. *(In progress: `@tracker-engine/core`
and `@tracker-engine/local-first` extracted; engine is schema- + deps-injected.)*

**Phase B — second app joins (still monorepo).** Add `apps/ledger` alongside `apps/rep` in the
same repo. Still symlinked, still no publish. This is the important step: a second real consumer
is what exposes the wrong abstractions in the engine, cheaply, while fixes are still one commit.
Relocating REPutation into `apps/rep/` (and pointing Vercel/Capacitor at the new path) happens
here — it's the riskiest move and gains nothing earlier.

**Phase C — split to polyrepo (engine stabilized).** Extract `tracker-engine/` to its own repo,
add a build (`tsc` emit) + Changesets + publish-on-tag to GitHub Packages. Split each app into
its own repo consuming the published `@tracker-engine/*`. Marketing sites are already independent
repos, so they just move under the umbrella. The handbook (`~/tracker-apps/README.md` + `docs/`)
already lives outside any app repo, so nothing about the philosophy has to move — which is the
point of setting the folder up this way now.

**Trigger for C:** the engine API has stopped changing weekly **and** ≥2 apps are shipping on
independent schedules. Before both are true, the monorepo is cheaper.

## Why this ordering

The engine's design is only validated by a second consumer, and the cost of a wrong abstraction
is lowest while everything is one atomic commit. Publishing/versioning is pure overhead until
apps genuinely need to move independently. So: **prove the engine in a monorepo with two apps,
then split.** The umbrella folder + handbook exist from day one so the eventual split is a set
of directory moves and a publish pipeline — never a rethink.

## Open decisions

- **Registry** for Phase C: GitHub Packages (recommended) vs git-tag deps.
- **One Supabase project per app** (recommended — clean RLS/quota isolation) vs shared.
- **`@tracker-engine/site-kit`** for marketing sites — defer until the sites duplicate.
