# Privacy Policy

_Last updated: 2026-08-13_

FitNote is a workout tracker built to keep your data on your device by default.
This policy describes what the app collects, where it lives, and what you can
do with it.

## What we collect

You choose whether to sign in. That choice determines what the app collects.

### Device-only mode (no sign-in)

If you never sign in, **nothing leaves your device**. Everything you log —
sessions, sets, templates, body metrics, preferences — lives in that browser's
IndexedDB. There is no account, no server round trip, and no analytics.

If you clear this site's data, uninstall the browser, or switch devices, that
history is gone. Export a JSON backup from Settings → Data if you want a copy.

### Signed-in mode (email account)

When you sign in with email, the app stores the following on our server
(Supabase Postgres, RLS-scoped to your user id):

- **Account:** email address, an internal user id.
- **Profile:** display name, units, week-start day, weekly workout goal,
  optional height, optional body-fat and bodyweight caches, optional
  free-text training goal, appearance preferences.
- **Training data:** workouts, exercises within them, individual sets, personal
  records, templates, custom exercises, body metric entries (bodyweight,
  body fat, waist, resting HR, etc. — whatever you choose to log).
- **Sync bookkeeping:** timestamps used to reconcile writes across devices.

Row-Level Security is enforced at the database, per table, and covered by an
automated test suite. Another signed-in user cannot read or write your rows.

Passwords are never collected. Sign-in uses a single-use email link (with an
emailed code as fallback) via Supabase Auth.

### Error diagnostics

When you are signed in, the app may write a scrubbed error record to the
server if it hits a bug: the error message, its JavaScript stack trace, the
page URL, the browser user agent, and a build identifier. **No request bodies,
no form fields, no training data.** The record scopes to your account via the
same RLS rules as your other data. Device-only mode reports nothing.

You cannot read your own error history from within the app; only the developer
can, via a service role in the database dashboard. Errors delete with the
account.

### AI coach

The AI coach is optional. When you use it, the app sends a **de-identified
summary** of your recent training to a Google Gemini endpoint via our backend:

- Aggregates by week, exercise, region, and equipment.
- Weights already converted to your preferred unit.
- Dates only as **week offsets** relative to the current week (e.g. `-3` for
  three weeks ago). No absolute dates.
- Your bodyweight, height, and free-text training goal, when set.

No names, no notes, no absolute dates, no session titles. The full contract is
in `src/features/coach/summary.ts` and the "What's sent" button in the coach
screen shows the exact payload before you use it.

Google processes this request under their API terms. We do not train a model on
your data.

## What we do not collect

- No third-party analytics (no Google Analytics, no Mixpanel, no PostHog).
- No third-party error monitoring (no Sentry). Error diagnostics are
  first-party, above.
- No advertising, ad IDs, or trackers.
- No location.
- No contacts, calendars, photos, microphone, or camera.

## Where your data lives

- On your device: IndexedDB in your browser, and (in signed-in mode) session
  tokens in `localStorage` for auth.
- On the server: Supabase (Postgres + Auth + Edge Functions), deployed in the
  region of the project. AI-coach requests transit Google's Gemini API.
- Static hosting: Vercel serves the app; the site is proxied under
  `hirshguha.com/workout-tracker`.

## What you can do

- **Export.** Settings → Data → Export downloads a versioned JSON file
  containing every one of your rows.
- **Import.** Settings → Data → Import restores from that file.
- **Local wipe.** Settings → Data → Clear this device's data removes
  everything in this browser's IndexedDB. Synced accounts re-download from the
  server; device-only accounts lose their history.
- **Delete account.** Account → Delete account removes your auth user and
  cascades to every row you own on the server. This is not reversible.

## Data retention

Rows persist until you delete them, delete your account, or clear local
storage. Diagnostic error records are retained for developer troubleshooting
and delete with the account.

## Children

FitNote is not directed at children under 13. Do not create an account for a
child under 13.

## Changes

We may update this policy. Material changes will be reflected in the
"Last updated" date at the top and, when relevant, announced in-app.

## Contact

Questions: open an issue at
[github.com/hguha/workoutTracker](https://github.com/hguha/workoutTracker) or
email the address listed in Account → Settings.
