// Re-exported from the shared @tracker-engine/core package — the first package extracted in
// the monorepo split (see docs/design-expense-tracker.md §3). Kept as a shim so the
// existing `@/lib/cn` importers don't have to change; new code can import from
// '@tracker-engine/core' directly.
export { cn } from '@tracker-engine/core'
