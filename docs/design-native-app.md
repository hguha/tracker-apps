# Design: FitNote on the App Store and Play Store

**Status:** designed, not built · **Supersedes spec §18**, which was iOS-only and
referenced abstractions that don't exist yet. This doc is grounded in the code as
it stands and covers both stores.

## The decision

Wrap the existing web build in **Capacitor**. Capacitor loads our `dist/` in a
native WebView, bridges to native APIs through plugins, and emits a standard
**Xcode project** (→ App Store) and a **Gradle project** (→ Play Store) from the
*same* `dist/`. One codebase, one web build, two store artifacts.

Rejected alternatives:

- **Rewrite in React Native / Flutter.** Throws away a finished, tested app. No.
- **TWA / Bubblewrap (Android-only).** Wraps the deployed PWA URL in a Chrome
  Custom Tab. It would work for Play Store, but it can't give us haptics or
  local notifications, and it's Android-only — so we'd still need Capacitor for
  iOS. Using Capacitor for both keeps one native story.
- **PWABuilder.** Same class of wrapper; less control than Capacitor and weaker
  on the Apple 4.2 "not just a website" bar (below).

## What does NOT change

Everything above the native seam. The data model, `data/` repository boundary,
`sync/` engine, RLS, charts, metrics, the coach, and every screen run byte-for-byte
identical inside the WebView. The app is already a well-behaved SPA with
state-based navigation (no router — §15), local-first storage, and safe-area
padding (`pt-safe`), which is exactly what a WebView shell wants.

The web deploy at `hirshguha.com/workout-tracker` keeps shipping in parallel. The
native apps are an additional distribution channel over the same build, not a fork.

## The native seam

There is no native abstraction in the code today (spec §18 implied one; it was
aspirational). We add a thin one:

```
src/lib/platform.ts        isNativePlatform(): boolean   // Capacitor.isNativePlatform(), false on web
src/platform/haptics.ts    tap(), success()              // Capacitor Haptics ⟂ navigator.vibrate
src/platform/files.ts      exportBackup(json), pickBackup(): Promise<string | null>
src/platform/notify.ts     scheduleRestDone(at), cancelRestDone()
src/platform/statusBar.ts  applyStatusBarStyle(scheme)
```

Each adapter is the ONLY place that branches on `isNativePlatform()`; callers stay
platform-blind. On web, every adapter is the current behavior verbatim, so the web
build is unaffected and the `@capacitor/*` packages tree-shake out (they're only
imported behind the native branch, dynamically).

### 1. Base path — the one build-config change

The web app is served under `/workout-tracker/`; a WebView serves from the bundle
root. `vite.config.ts` already makes this overridable:

```bash
BASE_PATH=/ npm run build      # native build; assets resolve from '/'
```

`import.meta.env.BASE_URL` becomes `/`, which flows correctly through the auth
redirect and asset URLs. No code change — just the build flag, wired into a new
`build:native` script.

### 2. Service worker — must be OFF in native

`registerServiceWorker()` is currently gated on `import.meta.env.PROD`, but the
native build is *also* PROD. A SW inside Capacitor is redundant (the WebView
already serves local files) and can cause update staleness. Add one guard:

```ts
if (isNativePlatform()) return   // Capacitor serves the bundle; no SW layer
```

`navigator.storage.persist()` becomes a harmless no-op in native — WKWebView /
Android WebView storage isn't subject to Safari's eviction — so it can stay.

### 3. Haptics — a clean wrap of one existing helper

`sounds.ts` already funnels every buzz through a single `vibrate(pattern)` helper
(and `DragList.tsx` has one direct `navigator.vibrate(18)`). `navigator.vibrate`
does **nothing** on iOS (WKWebView never supported it), so today iOS users get no
haptics at all. `@capacitor/haptics` fixes that on both platforms.

`vibrate()` becomes: native → `Haptics.impact({ style })`; web → `navigator.vibrate`
unchanged. The DragList call routes through the same helper. This is the cheapest
win *and* it directly strengthens the 4.2 case (real device integration).

### 4. Export / import — native share sheet + file picker

`DataScreen.tsx` exports via a `Blob` + `URL.createObjectURL` + `<a download>` and
imports via a hidden `<input type=file>`. Both technically function in a WebView
but feel broken (no share sheet, clumsy picker). Fork the two handlers through
`platform/files.ts`:

- **Export:** native → `@capacitor/filesystem` writes to a cache dir, then
  `@capacitor/share` opens the OS share sheet (Files, AirDrop, Drive, email).
  Web → today's download.
- **Import:** native → `@capacitor/filesystem` + a native document picker returns
  the file text. Web → today's `<input type=file>`.

The JSON payload and `data/backup.ts` parsing are identical; only the byte-transport
boundary differs. This is the `isNativePlatform()` fork §18 mentioned.

### 5. Rest-timer notification — genuinely NEW capability

Spec §18 framed this as "APNs instead of Web Push." Misleading: there is no Web
Push today. The rest timer is purely in-app — `restTimerStore` holds a `targetAt`
timestamp and the UI counts down; if the app is backgrounded or the phone locks,
nothing fires. Native `@capacitor/local-notifications` gives us the locked-screen
alert **for free** (local, no server, no APNs/FCM credentials):

- `start(seconds)` → `notify.scheduleRestDone(targetAt)`
- `extend(seconds)` → reschedule
- `cancel()` → `notify.cancelRestDone()`

These are the three existing actions in `restTimerStore`; the adapter hooks them.
No server, no push infrastructure, no §14 Cloudflare Durable Object. (Server-scheduled
push for a *closed* app remains out of scope; a local notification covers
backgrounded/locked, which is the real gym case.)

### 6. Status bar & safe areas

The app already pads for the notch (`pt-safe`). Add `@capacitor/status-bar` to set
the bar style from the active color scheme (the `applyDefaultAppearance` path
already knows light/dark), and set the WebView background to the theme surface so
there's no white flash on launch. `@capacitor/splash-screen` renders `icon.svg` on
a theme-colored field while the WebView boots.

### 7. Audio — unchanged

`sounds.ts` synthesizes cues with Web Audio and already handles the iOS
silent-switch / interrupted-session dance (the hardest part, done). WKWebView runs
Web Audio fine, so audio needs **no** native work. Haptics (above) complement it.

## Auth — the one subtle piece, already de-risked

Magic-link sign-in uses `emailRedirectTo: window.location.origin + BASE_URL`. Inside
Capacitor, `window.location.origin` is `capacitor://localhost` (iOS) or
`http://localhost` (Android), so a magic link can't redirect back into the app
without deep-link plumbing.

**But the OTP code path already exists (§11.3) and needs zero deep-linking.** The
user taps "email me a link," gets the mail, and pastes the code — `verifyOtp`
establishes the session with no redirect. So **auth works on day one in native**
through the code field. The magic link simply won't round-trip until we wire deep
links; the code makes that a non-blocker.

**Phase 2 — make the magic link round-trip (polish):**

1. **iOS Universal Links / Android App Links** on `hirshguha.com/workout-tracker/*`
   (host an `apple-app-site-association` file and an `assetlinks.json` — both on
   the domain we control).
2. Add the native redirect URL to Supabase Auth's **Redirect URL allowlist**.
3. `@capacitor/app`'s `appUrlOpen` listener catches the opened link and hands the
   URL fragment to `supabase.auth` to complete the session (supabase-js already
   runs `detectSessionInUrl` + implicit flow — §supabaseClient — which parses it).

Until Phase 2, the "Resend the link" affordance stays, and the code field is the
primary native path.

## Build & release pipeline

New scripts (`package.json`):

```jsonc
"build:native": "BASE_PATH=/ tsc --noEmit && BASE_PATH=/ vite build",
"native:sync":  "npm run build:native && cap sync",
"native:ios":   "npm run native:sync && cap open ios",
"native:android": "npm run native:sync && cap open android"
```

One-time init: `npm i -D @capacitor/cli && npm i @capacitor/core`, then
`npx cap init FitNote com.hirshguha.fitnote --web-dir dist`, then
`cap add ios` / `cap add android`. Plugins: `@capacitor/haptics`,
`@capacitor/filesystem`, `@capacitor/share`, `@capacitor/local-notifications`,
`@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/app`.

Release loop per store: `npm run native:sync` → open the native IDE → bump
version/build number → Archive (iOS) or generate a signed AAB (Android) → upload.
`fastlane` can automate the archive/upload later; not needed for the first submit.

`ios/` and `android/` are committed to the repo (they hold native config, signing
settings, and plugin registration). `dist/` stays gitignored; `cap sync` repopulates
the native web assets from it.

## Store submission requirements

### Apple App Store

- **Apple Developer Program — $99/year** (the one unavoidable cost).
- **Guideline 4.2 ("minimum functionality / not just a website").** The offline-first
  local database, haptics, local notifications, and share-sheet export are the
  concrete device integrations that clear this. This is *why* §3–6 above aren't
  optional polish — they're the review argument.
- **Guideline 5.1.1(v) — account deletion in-app.** Already built (Account → Delete
  account → the `delete-account` Edge Function cascades from `auth.users`).
- **App Privacy questionnaire.** Easy and honest: local-first, no third-party
  analytics, no tracking, no data sold. Declare: email (account), health/fitness
  data (workouts, body metrics) stored on our server for the user's own sync; AI
  coach sends a de-identified aggregate to Google (disclosed). First-party error
  logs, no request bodies.
- **Privacy policy URL** — `docs/privacy-policy.md`; host a rendered copy on the
  domain (see the open item in the privacy-policy follow-up).
- Icons + launch screen from `public/icon.svg`; screenshots per device class.

### Google Play Store

- **Play Console — $25 one-time.**
- **Data safety form** — the Play analog of Apple's privacy questionnaire; same
  honest answers.
- **Target API level** — must meet Play's current minimum (Capacitor's default
  template tracks it; bump `targetSdkVersion` if flagged).
- **App signing** — enroll in Play App Signing; keep the upload key safe.
- **Account deletion** — Play also requires an in-app path *and* a web URL to
  request deletion; the in-app flow exists, and the deletion request can point at
  the same account screen / a support email in the listing.
- Adaptive icon + feature graphic + screenshots.

## Accounts & cost

| | Cost | Cadence |
|---|---|---|
| Apple Developer Program | $99 | per year |
| Google Play Console | $25 | one-time |
| Everything else (Supabase, Vercel, Gemini, domain) | $0 | unchanged |

## Phasing

1. **Shell up (both platforms).** Capacitor init, `build:native`, SW guard, status
   bar + splash. App runs in both simulators against the real backend. Auth via the
   OTP code path.
2. **Device integration.** Haptics wrap, export/import fork, rest-timer local
   notification. This is the 4.2 argument and the bulk of the felt-native value.
3. **Auth deep links.** Universal Links / App Links + Supabase allowlist + the
   `appUrlOpen` handler, so the magic link round-trips.
4. **Submit.** Assets, privacy questionnaires, screenshots; Apple review + Play
   review. Apple is the slower gate (expect a round of feedback); Android is fast.

Realistically **days of work, not weeks** — most of the calendar time is the Apple
account, store assets, and one review cycle, not code.

## Risks

- **Apple 4.2 rejection** if the build reads as a website. Mitigation: Phase 2 lands
  before submission, and the review notes call out the offline-first local DB,
  haptics, and notifications explicitly.
- **Magic-link confusion in native before Phase 3.** Mitigation: the code field is
  the primary native affordance until deep links land; copy makes it clear.
- **WebView storage durability.** IndexedDB in WKWebView/Android WebView is more
  durable than Safari's (no 7-day eviction), so native is *safer* than the PWA here,
  not riskier — but a bad "clear app data" from the OS still wipes it. The existing
  export/import (now on the native share sheet) is the backstop.
- **Version skew** between the web deploy and the store build. Mitigation: the
  `VITE_APP_VERSION` stamp already ties any error log to a commit; the store build
  carries its own build number on top.
