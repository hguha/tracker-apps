// Build stamp: `<pkg version>+<git sha>`, injected at build time by vite.config.ts
// (from VERCEL_GIT_COMMIT_SHA, else `git rev-parse HEAD`). 'dev' under `vite dev`.
// Surfaced in the UI so a running build can be tied to a commit.
export const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev'
