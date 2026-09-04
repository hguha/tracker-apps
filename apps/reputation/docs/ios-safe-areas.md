# iOS safe areas: what's been tried

Three targets render this app and each treats safe areas differently:

| Target | Who insets | `env(safe-area-inset-*)` |
|---|---|---|
| Browser tab (Safari/Chrome) | browser chrome | reports real values |
| **Installed PWA** (home screen) | nobody — the app covers the full screen | **unreliable** |
| Native shell (Capacitor) | nobody — `contentInset: 'never'` | reports real values |

`viewport-fit=cover` does **not** make iOS inset anything. It only decides whether
`env(safe-area-inset-*)` reports real numbers or zero.

## An installed web app pins its window geometry at install time

**This is what caused the long chase.** iOS fixes a home-screen web app's window
configuration (viewport-fit, status-bar treatment) when it is added. Page content —
HTML, CSS, JS — updates on every launch, so the app looks up to date while the *window*
is still laid out per whatever `index.html` said the day it was installed. Editing
`viewport-fit` and reloading therefore proves nothing.

The signature, measured via Settings → Data & sync:

```
inset 62/34 · pad 62/0 · 894px of 956 (short 62) · scroll 0 over 0 off 0 · installed dm✗
```

`956 − 894 = 62`, exactly the top inset — the window is sized as if it excluded the
status bar, which is non-`cover` geometry, even though the served HTML has
`viewport-fit=cover`.

**Do not read `window.screenY` to find where the window sits.** An earlier version of
this doc called it "the decisive number"; iOS pins it to `0` for a home-screen web app
regardless of the window's real position, so it can never distinguish the two cases. The
two readings that *do* settle it:

- iOS reports `safe-area-inset-top: 62` to the installed app while reporting `0` to a
  Safari tab. It only makes the app responsible for that region if the app covers it —
  so the window starts at screen y=0 and top padding really is needed.
- A screen whose header lacked `pt-safe` rendered *behind* the translucent status bar,
  visibly ghosted under the clock. Same conclusion, from the other direction.

So: window at y=0, 894 tall, on a 956 screen → the bottom 62px is outside the web view.
That is the "black bar", and no stylesheet can paint it.

**What follows from that (and what doesn't).** The 34px bottom inset is worse than
useless in this state: the home indicator lives in the dead strip *below* the window, so
padding for it inside the window turns a 62px gap into a 96px one. Hence
`html[data-shell='installed'][data-viewport='short'] .pb-safe { padding-bottom: 0 }` —
`data-viewport` is published by `platform/viewport.ts` from the measured shortfall, so
the rule disappears by itself once the geometry is healthy. It shrinks the damage; it
does not fix it. Only a reinstall can.

**So: after any change to the viewport or status-bar metas, delete the home-screen app
and re-add it.** A refresh, or even a service-worker update, cannot fix window geometry.
Confirm with the Display row: the viewport height should equal `screen`.

## `@media (display-mode: standalone)` DOES NOT MATCH on iOS

This wasted several rounds. An installed iOS web app sets `navigator.standalone === true`
but does **not** match `@media (display-mode: standalone)` — so any CSS gated on that
query silently does nothing, and an experiment gated on it produces a meaningless
result rather than a failure.

Detect the shell in JS and publish it as `data-shell` on `<html>` (see `main.tsx`):
`native` (Capacitor) / `installed` (`navigator.standalone`) / `browser`. Gate CSS on
that attribute. The Display row shows the resolved shell plus whether the query agrees,
e.g. `installed dm✗`.

## Insets are already applied for an installed web app (commit b2f869e)

Measured: a Safari tab reports `0/0` and looks right; the installed app reports `62/34`
and looks wrong by about that much. iOS has already inset the installed web view — it
just still *reports* the insets — so honouring them pads twice. `.pt-safe`/`.pb-safe`
therefore resolve to **0** under `html[data-shell='installed']`. Native keeps them
(`contentInset: 'never'` means it must pad itself); a browser tab reports 0 anyway.

## A theory that measurement killed (commit 1bdb953)

On an installed iPhone app the insets report **correctly** — 62 top / 34 bottom. The
fault was the **height**: `height: 100%` resolved to **894px**, taller than the visible
area. The document could then scroll by the difference, and once it did the top,
including that 62px of inset padding, was pushed out of view. Hence "shifted up", "top
controls unreachable" and "gap at the bottom" — all one bug, none of it about padding.

Fix: size the shell with **`100svh`** (small viewport height) so it can never exceed
the screen, plus `body { overflow: hidden }` since every screen owns its own scroller.
`svh` not `dvh`: `dvh` tracks the dynamic size and can be the larger value.

Reference measurements (iPhone 16):

| Target | insets | height |
|---|---|---|
| installed PWA | 62 / 34 | 894px ← taller than the screen with `100%` |
| Safari tab | 0 / 0 | 742px |

## Current state (the baseline that worked)

Unchanged since the first commit, and restored after four failed experiments:

- `index.html`: `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style: black-translucent`
- `.pt-safe` / `.pb-safe`: plain `env(safe-area-inset-top/bottom)`, **no floor**
- `html, body, #root { height: 100% }`
- `html { background: var(--surface-page) }` so no gap can show through black

Known remaining issue: in the installed PWA the top sits slightly higher than ideal.
Native and browser are correct.

## Ruled out on real hardware — don't retry these

| Change | Result |
|---|---|
| `status-bar-style: default` (keeping `cover`) | insets report 0; content under the status bar, top controls unreachable, black strip at the bottom |
| Dropping `viewport-fit=cover` | still full-screen, insets now 0; overlaps the Dynamic Island and home indicator |
| `height: 100dvh` on `html/body/#root` | tracks the *dynamic* size, so it can be the larger value and behaves like `100%`. Use `100svh` |
| `max(env(...), 48px)` floor under `@media (display-mode: standalone)` | the query never matched, so this did nothing — the observed change came from other edits in the same commit |
| Mutating the viewport meta at runtime in `main.tsx` | depends on the Capacitor bridge being ready; shifts layout after first paint |

## Before changing anything here

1. **Read the numbers, don't guess.** Settings → Data & sync shows a `Display` row.
   The one to check is `<window>px of <screen>`: if it says `short N`, N pixels of the
   screen are outside the web view and the problem is geometry, not padding. Every
   failure above came from assuming a value rather than reading it — and one came from
   reading a value (`screenY`) that iOS doesn't populate.
2. **Re-install to test.** iOS pins window geometry at install; a reload cannot change
   it, so a meta-tag change tested by refreshing proves nothing about the window (only
   about `env()`, which *is* live). Delete the home-screen app and re-add it, then check
   that the Display row no longer says `short`.
3. **Check all three targets**, since a fix for one has repeatedly broken another.

## Layout rules that prevent the worst failure

Whatever the insets say, content must never become unreachable:

- Centre full-height screens with `m-auto` inside an `overflow-y-auto` flex column —
  never `justify-center`, which clips the overflow's top with nothing to scroll back
  to. (Also bites when the keyboard is up.)
- Keep the canvas background on `html`, so any area the layout misses paints as the
  app's own colour rather than black.
