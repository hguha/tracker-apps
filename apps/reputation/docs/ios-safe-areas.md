# iOS safe areas

Three targets render this app:

| Target | Window | `env(safe-area-inset-*)` |
|---|---|---|
| Browser tab | below the browser chrome | `0/0` — the chrome already clears the insets |
| Installed PWA | below the status bar, fills the rest | `0/34` for the home indicator |
| Native (Capacitor) | edge to edge (`contentInset: 'never'`) | real device insets |

**One rule covers all three:** `.pt-safe` / `.pb-safe` are plain
`env(safe-area-inset-top/bottom)`. iOS reports those relative to the *window*, so the
same declaration is correct everywhere and no shell-specific CSS is needed. There is
none in the app, and adding some means something else is wrong.

## The bug that made this look hard

`apple-mobile-web-app-status-bar-style: black-translucent` was in `index.html`. It moves
an installed app's window up to draw under the status bar, but iOS still *sizes* that
window as if it began below one. The result on an iPhone 16 Pro Max:

```
inset 62/34 · 894px of 956 · installed dm✗ · ⚠︎ stale 62
```

A 894pt window at y=0 on a 956pt screen. Content hid under the Dynamic Island, and the
62pt left over at the bottom was outside the web view entirely — unpaintable by any
stylesheet, which is the "black bar". Every attempt to fix it in CSS therefore failed,
and each fix made another target worse.

Removing the meta leaves `display: standalone` from the manifest, which gives the ordinary
geometry: a window below the status bar reporting `inset 0/34`, needing no help.

**A window short of the screen is not by itself a bug.** A window that starts below the
status bar is legitimately `screen − 62` tall, and it reports a top inset of `0` because
nothing overlaps it there. The broken state is *short **and** reporting a top inset*: the
app is being told to clear a status bar it cannot be sitting below. That contradiction is
what `hasStaleWindow()` tests and what the Display row flags as `stale`.

### Why the timeline is confusing

The meta was **not** a recent regression — it was added early (`9cdd473`) and was present
throughout the period the app looked fine. The original `index.html` (`4420eae`) had
neither it nor a manifest link. What changed was **the install, not the code**: iOS pins
window geometry when an app is added to the Home Screen and never revisits it, so the
long-lived home-screen icon kept its original geometry while the served HTML drifted. The
break surfaced when the app's URL moved (`hirshguha.com/workout-tracker` →
`reputation.fitness/app`, `e2adc78`) and the icon had to be re-added — picking up
`black-translucent` for the first time, ~13 commits before the symptom was reported.

So a meta-tag change tested by reloading proves nothing about the window. Delete and
re-add the home-screen app.

## Two traps

- **`@media (display-mode: standalone)` never matches** in an installed iOS web app, so
  CSS gated on it silently does nothing and an experiment gated on it yields a
  meaningless result rather than a failure. `navigator.standalone` is the real signal
  (`platform/viewport.ts`); the Display row shows `dm✗` to keep this visible.
- **`window.screenY` is always 0** for a home-screen web app, whatever the window's real
  position. It was reported as `at 0` and treated as proof the window sat at the top of
  the screen; it proves nothing.

## Before changing anything here

1. **Read the Display row** (Settings → Data & sync) on the affected target first. It
   should be clean; `⚠︎ stale N` means the window is from an older install and the problem
   is geometry, not padding — the screen says so in plain words too.
2. **Re-install to test** anything involving the viewport or status-bar metas.
3. **Check all three targets** — a fix for one has repeatedly broken another.

## Ruled out on hardware

`status-bar-style: default` while keeping `black-translucent`'s geometry (insets go to 0
with the window still at y=0); dropping `viewport-fit=cover` (insets go to 0, overlaps
the island and home indicator); `height: 100dvh` (tracks the dynamic size, so it can be
the larger value — `100svh` is what's wanted); a `max(env(...), 48px)` floor gated on
`display-mode` (the query never matched); mutating the viewport meta at runtime; zeroing
or overriding insets per shell.

## Layout rules

- Centre full-height screens with `m-auto` inside an `overflow-y-auto` flex column, never
  `justify-center` — that clips the overflow's top with nothing to scroll back to.
- Keep the canvas background on `html`, so any area the layout misses paints as the app's
  own colour rather than black.
