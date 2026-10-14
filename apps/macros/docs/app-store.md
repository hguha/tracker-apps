# MACROcosm on the App Store

Bundle id `com.hirshguha.macrocosm` · team `RY5BSSDT58` · version 1.0.0 · iPhone only · portrait.

## Release checklist (owner)

Done already: bundle id `com.hirshguha.macrocosm` is registered (team RY5BSSDT58), the demo account is seeded, and a signed 1.0.0 build archives cleanly.

1. **Decide the Gemini tier.** The coach, meal descriptions and meal photos use the Gemini API on the free tier. Google's terms let it use free-tier prompts (including photos) to improve its products, which contradicts the privacy policy's "No model is trained on your data". Either enable billing on the Gemini key, or change that sentence in `public/privacy.html` and add **Photos** and **Other User Content** shared with a third party in App Privacy.
2. **Push** so `macrocosm.fitness/app/privacy.html` and `/app/support.html` are live.
3. **Create the app record**: App Store Connect → Apps → + → New App: iOS, name `MACROcosm`, primary language English (U.S.), bundle id `com.hirshguha.macrocosm`, SKU `macrocosm-ios`, full access.
4. **Upload**: `npm run release:ios:macros` from the repo root. Install from TestFlight and check sign-in, a scan, a photo estimate and a reminder on a real phone.
5. **Listing**: fill in the fields below, upload the seven screenshots from `docs/app-store-screenshots/` (6.9" display, 1320×2868), answer App Privacy and age rating as below, add the demo login to App Review Information, then Submit for Review.

## Listing

- **Name:** MACROcosm
- **Subtitle (30):** Calories measured, not guessed
- **Category:** Health & Fitness (secondary: Food & Drink)
- **Promotional text:** Log what you eat, weigh in most mornings, and MACROcosm measures what you actually burn — then sets your calories and macros from that, week by week.
- **Keywords (≤100):** `calorie counter,macro tracker,food diary,TDEE,protein,nutrition,weight loss,meal log,diet,bulk`
- **Support URL:** https://macrocosm.fitness/app/support.html (contact is GitHub issues, as for REPutation)
- **Marketing URL:** https://macrocosm.fitness
- **Privacy Policy URL:** https://macrocosm.fitness/app/privacy.html
- **Copyright:** 2026 Hirsh Guha

**Description**

MACROcosm is a calorie and macro tracker that measures your target instead of guessing it.

Log food from a database of whole foods and packaged products, scan a barcode, describe a meal in a sentence, or snap a photo. Weigh in when you can. Each week MACROcosm compares what you ate with how your weight trend actually moved, works out what you really burn, and adjusts your calories — never more than 150 kcal at a time, and only with your say-so if you prefer.

- See the day at a glance: calories, protein, carbs and fat against targets built around a protein floor.
- Recipes with real nutrition, worked out from their ingredients, including ones imported from a recipe link.
- Water, an eating window, and reminders that only arrive if a meal is still missing.
- Insights on intake, weight trend, habits and micronutrients.
- An AI coach that answers from your own numbers and never logs anything without your confirmation.
- Works fully offline with no account. Sign in to sync across devices and back up.

## App Privacy answers

Tracking: **No**. Data is used for **App Functionality** only, and all of it is **linked to the user** (account-scoped). Nothing is collected in device-only mode.

| Category | Type | Why |
|---|---|---|
| Contact Info | Email Address | Sign-in |
| Health & Fitness | Health | Weigh-ins, height, goal (synced) |
| User Content | Other User Content | Food log, recipes, notes (synced) |
| Identifiers | User ID | Account id on synced rows |
| Diagnostics | Crash Data, Other Diagnostic Data | Error reports to our own database |

Not collected: location, contacts, browsing, purchases, advertising data. Photos and coach messages are sent for real-time processing only (see checklist item 1 for the free-tier caveat).

## Age rating

Answer **None** to every content question and **No** to unrestricted web access, gambling, contests and user-generated content sharing. The privacy policy states it is not directed at children under 13.

## Export compliance

Uses only standard HTTPS/TLS. `ITSAppUsesNonExemptEncryption` is `false` in Info.plist, so no annual self-classification is needed.

## App Review notes

1. **Screen recording:** attach a short recording: sign in with the demo account → Today → Log food → search "chicken" → Log it → Insights → Settings → Coach → one question.
2. **Devices tested:** iPhone (iOS 18/26) and the iOS simulator.
3. **What the app does:** a calorie and macro tracker that measures energy expenditure from the user's own logs and weigh-ins and sets weekly targets from it.
4. **Sign-in:** demo account `demo@macrocosm.fitness` (password in App Review Information), already confirmed and onboarded, with five weeks of logs. Sign-in is email + password or a 6-digit emailed code; "Use this device only" on the first screen gives the full app with no account.
5. **External services:** Supabase (auth, Postgres with row-level security, Edge Functions); Google Gemini API (coach and meal estimates, called server-side); USDA FoodData Central and Open Food Facts (food lookups); Resend (sign-in emails). No payments, no in-app purchases, no ads, no analytics or tracking SDKs.
6. **Permissions:** Camera (barcode scan and meal photo, on tap), Photos (pick a meal photo), Notifications (opt-in reminders). No HealthKit.
7. **Regional differences / regulated content:** none. English only. Calorie targets are general guidance, floored at safe minimums, and not medical advice.

## Demo account seed

Already run. To redo it, from the repo root with the project's service role key (`npx supabase projects api-keys --project-ref kofgokucenxojecqbyhr`):

```
SUPABASE_URL=https://kofgokucenxojecqbyhr.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… DEMO_PASSWORD=… \
node apps/macros/scripts/seed-demo-account.mjs
```

It creates or updates `demo@macrocosm.fitness` with a confirmed email, marks it onboarded, signs in through a local dev server on port 5642 with the real backend, loads the app's own demo history (five weeks of logs, weigh-ins, recipes, water and a program), waits for sync, and prints row counts. It leaves an account that already has logs untouched.
