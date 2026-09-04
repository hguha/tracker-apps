# iOS safe areas: what's been tried

Three targets render this app and each treats safe areas differently:

| Target | Who insets | `env(safe-area-inset-*)` |
|---|---|---|
| Browser tab (Safari/Chrome) | browser chrome | reports real values |
| **Installed PWA** (home screen) | nobody — the app covers the full screen | **unreliable** |
| Native shell (Capacitor) | nobody — `contentInset: 'never'` | reports real values |

`viewport-fit=cover` does **not** make iOS inset anything. It only decides whether
`env(safe-area-inset-*)` reports real numbers or zero.

## The actual root cause (found by measuring, commit 1bdb953)

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
| `max(env(...), 48px)` floor under `@media (display-mode: standalone)` | markedly worse — content shifted far too high with black bars returning |
| Mutating the viewport meta at runtime in `main.tsx` | depends on the Capacitor bridge being ready; shifts layout after first paint |

## Before changing anything here

1. **Read the numbers, don't guess.** Settings → Data & sync shows a `Display` row:
   `inset <top>/<bottom> · <window height>px · <browser|installed|native>`. Get that
   from the affected target first — the failures above all came from assuming an
   inset value rather than reading it.
2. **Re-install to test.** The service worker is network-first for HTML, but an
   installed app that launches offline can still show the previous shell. Deleting and
   re-adding the home-screen app removes all doubt.
3. **Check all three targets**, since a fix for one has repeatedly broken another.

## Layout rules that prevent the worst failure

Whatever the insets say, content must never become unreachable:

- Centre full-height screens with `m-auto` inside an `overflow-y-auto` flex column —
  never `justify-center`, which clips the overflow's top with nothing to scroll back
  to. (Also bites when the keyboard is up.)
- Keep the canvas background on `html`, so any area the layout misses paints as the
  app's own colour rather than black.
