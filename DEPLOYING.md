# Deploying

Served at **`hirshguha.com/workout-tracker`** from its own Vercel project, which
the website project proxies to. Two repos, two projects, independent deploys — a
build failure here can never block `hirshguha.com`.

```
  hirshguha.com/workout-tracker/*
            │
            │  rewrite, prefix preserved
            ▼
  workout-tracker-khaki-five.vercel.app/workout-tracker/*
```

Both are live. The rewrite lives in `HirshGuhaNewWebsite/next.config.mjs`.

## Setup — already done

For reference, since this is the kind of thing you only touch once:

1. **This repo** is on GitHub at `hguha/workoutTracker`.
2. **Its Vercel project** builds from `vercel.json` — framework, build command,
   and output directory all come from there, so don't override them in the
   dashboard.
3. **The rewrite** is in `HirshGuhaNewWebsite/next.config.mjs`, pointing at
   `workout-tracker-khaki-five.vercel.app`.

The rewrite needs **two** entries, because `:path*` does not match the bare
parent path — without the first, `/workout-tracker` itself would 404:

```js
{ source: '/workout-tracker',         destination: `${ORIGIN}/workout-tracker` },
{ source: '/workout-tracker/:path*',  destination: `${ORIGIN}/workout-tracker/:path*` },
```

Note the prefix is **preserved**, not stripped. The app's own `vercel.json` also
rewrites `/workout-tracker/*` onto its files, so both the proxied URL and the
bare `*.vercel.app` URL work — the latter is handy for checking a deploy before
it's live on the domain.

### Worth doing at some point

Give the Vercel project a stable alias (Project → Settings → Domains), e.g.
`workout-tracker-hg.vercel.app`, and point the rewrite at that instead. The
generated `khaki-five` hostname is tied to the current project name; renaming the
project would silently break the rewrite.

## After that

Push to this repo → Vercel builds and deploys → live at
`hirshguha.com/workout-tracker`. The website is not rebuilt and is not involved
beyond forwarding the request.

## Verifying a deploy

```bash
curl -sI https://hirshguha.com/workout-tracker | head -3
```

Expect `200`. Then load it in a browser and confirm the sign-in screen renders
with its blue button — a blank or unstyled page almost always means an asset path
problem (see below).

To test the website's rewrite locally before pushing it:

```bash
cd ~/HirshGuhaNewWebsite && npx next build && npx next start -p 4200
curl -s http://127.0.0.1:4200/workout-tracker | grep '<title>'   # → Workout Tracker
```

This proxies to the *live* app deployment, so it verifies the rewrite itself
rather than a local build.

## The base path

`vite.config.ts` sets `base: '/workout-tracker/'`, so built asset URLs are
absolute from that prefix:

```html
<script src="/workout-tracker/assets/index-abc123.js">
```

This is required. With the default `base: '/'`, the browser would request
`hirshguha.com/assets/…` — which belongs to the website, not this app, and 404s.

To host at a bare domain instead:

```bash
BASE_PATH=/ npm run build
```

## The service worker

Shipped. Lives at `public/sw.js` — Vite copies it to `dist/sw.js` verbatim, so
`hirshguha.com/workout-tracker/sw.js` is what the browser fetches. Registration
happens in `src/lib/serviceWorker.ts`, gated on `import.meta.env.PROD` so `vite
dev` never installs one (a stale cache during iteration is the worst debug loop).

Two things to keep straight:

1. **Scope must be `/workout-tracker/`.** The origin is shared with the
   marketing site, so a root-scope worker would intercept the marketing site's
   requests too and serve a cached FitNote shell in place of it. Verify in
   DevTools → Application → Service Workers that the scope reads
   `/workout-tracker/` before shipping.
2. **`navigator.storage.persist()` matters more than the SW.** Registration
   calls it once. Without it, iOS (and desktop browsers under storage pressure)
   may evict the IndexedDB store that holds every logged set. The prompt is
   silent on most platforms; we call it every load and trust the browser to
   decide.

A subdomain would have been simpler for the PWA specifically; the subpath is a
deliberate trade for the nicer URL.

## Keeping the free-tier DB awake

Supabase pauses free-tier projects at ~1 week of inactivity. Two defenses run
in parallel:

- **DB heartbeat** (migration `0020`): `pg_cron` updates the `keep_alive` row
  daily at `03:17 UTC`. Guarantees DB activity even with zero users.
- **API heartbeat** (recommended, not yet wired): a GitHub Actions cron that
  hits the REST API every few days. This is what covers the case where
  "inactivity" means HTTP traffic, not DB writes.

The GH Actions half is a two-minute setup — add this to
`.github/workflows/keep-alive.yml`, replacing the URL with your project's:

```yaml
name: keep-alive
on:
  schedule:
    - cron: '11 4 */3 * *'   # every 3 days, 04:11 UTC
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -o /dev/null -w "%{http_code}\n" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            "https://<project-ref>.supabase.co/rest/v1/" \
            | grep -E '^(200|401)$'
```

The anon key is public by design (RLS is what protects data), so a repo secret
is fine. A 401 is expected — it still counts as API traffic, which is the point.

## First-party error logging

Signed-in users write to `client_errors` when the app hits a render error,
`window.onerror`, or an unhandled promise rejection. **No third-party SDK** —
§11.4 of the spec forbids it because the app holds health-adjacent data.
Contents: message, stack, page URL, user agent, build stamp. No request bodies,
no training data, no PII beyond what's already tied to the account.

The client has INSERT-only access; reads happen through the service role in the
dashboard:

```
select occurred_at, app_version, context, message, url
  from client_errors
 order by occurred_at desc
 limit 50;
```

The build stamp lives in `VITE_APP_VERSION` and is `<pkg>.<version>+<git-sha>`,
set at build time by `vite.config.ts` from `VERCEL_GIT_COMMIT_SHA` when Vercel
provides it, or `git rev-parse HEAD` locally.

---

# Native builds (App Store & Play Store)

The iOS and Android apps are the **same web build** wrapped in Capacitor (design:
`docs/design-native-app.md`). The web infra is in the repo already:
`capacitor.config.ts`, the `src/platform/*` seam, the `build:native`/`native:*`
scripts, and icon sources in `resources/`. What's left is generating the native
projects on a machine with the platform toolchains, then archiving and uploading.

## One-time machine setup (macOS)

```bash
# Xcode (full IDE, not just Command Line Tools) — from the Mac App Store, then:
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
# CocoaPods (Capacitor iOS uses it):
brew install cocoapods          # or: sudo gem install cocoapods
```

Android (only if shipping to Play): install Android Studio, then set
`ANDROID_HOME` and install an SDK platform + build-tools via its SDK Manager.

## One-time project generation

```bash
npm install                     # ensure Capacitor deps are present
npm run build:native            # produces dist/ with BASE_PATH=/
npx cap add ios                 # generates ios/  (runs pod install)
npx cap add android             # generates android/  (only if shipping to Play)
npm run native:icons            # writes app icons + splash into both projects
```

Commit `ios/` and `android/` (the `.gitignore` already excludes Pods/build noise).

## Every build after that

```bash
npm run native:ios              # build:native → cap sync → open Xcode
# or
npm run native:android          # → open Android Studio
```

`cap sync` copies the fresh `dist/` into the native project and updates plugins.
Always run it (via the scripts) after any web change.

## Shipping to the App Store — exact steps

Assumes the Apple Developer Program membership is active.

**A. App Store Connect — create the app record** (do once)
1. https://appstoreconnect.apple.com → **Apps → + → New App**.
2. Platform **iOS**; Name **FitNote** (must be globally unique — have a fallback
   like "FitNote Workout Log"); Primary language; Bundle ID
   **com.hirshguha.fitnote** (create it in the picker if it's not listed — it
   maps to an App ID in the Developer portal); SKU any string (e.g. `fitnote-ios`).

**B. Xcode — signing & version**
3. `npm run native:ios` opens the workspace. Select the **App** target →
   **Signing & Capabilities**.
4. Check **Automatically manage signing**; pick your **Team**. Xcode creates the
   provisioning profile. Confirm the bundle id reads `com.hirshguha.fitnote`.
5. Under **General**, set **Version** (e.g. `1.0.0`) and **Build** (`1`).
6. Add **Push Notifications** capability only if you later add remote push — the
   rest-timer notification is *local* and needs no capability. Local
   Notifications require no entitlement.

**C. Archive & upload**
7. Top device selector → **Any iOS Device (arm64)** (not a simulator).
8. **Product → Archive**. When the Organizer opens, select the archive →
   **Distribute App → App Store Connect → Upload**. Accept the defaults
   (automatic signing, symbols). This uploads the build.
   - Alternative: **Product → Archive → Distribute → Export**, then upload the
     `.ipa` with the **Transporter** app from the Mac App Store.

**D. App Store Connect — fill the listing** (while the build processes, ~10–30 min)
9. **App Privacy**: declare Email (account), Health & Fitness (workouts, body
   metrics — stored for the user's own sync), and diagnostics (first-party error
   log). Not used for tracking; not sold. See `docs/privacy-policy.md`.
10. **Privacy Policy URL**: a public page (host the rendered
    `docs/privacy-policy.md`).
11. Screenshots: at least 6.7" and 6.5" iPhone sizes. Description, keywords,
    support URL, category **Health & Fitness**.
12. **Age rating** questionnaire.
13. Under the version, **Build** → select the processed upload.
14. Confirm **account deletion** is described (it's in-app: Account → Delete
    account — Guideline 5.1.1(v)).

**E. Submit**
15. **Add for Review → Submit**. First review is typically 24–48h. If it bounces
    on Guideline 4.2 ("just a website"), the review notes should point out the
    offline-first local database, haptic feedback, and local rest notifications —
    those are the device integrations that clear it.

## Guideline 4.2 note

The device integration that makes the not-a-website case is real and in the
build: offline-first IndexedDB, haptics (`@capacitor/haptics`), and locked-screen
rest notifications (`@capacitor/local-notifications`). Keep them working before
submitting.
