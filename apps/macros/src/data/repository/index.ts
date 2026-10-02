/**
 * The only way features touch storage. Screens never import `@/db` directly, so the write
 * path (stamp, enqueue) can't be bypassed — the rule scripts/check-architecture.mjs enforces.
 */
export * from './profile'
export * from './foods'
export * from './history'
export * from './entries'
export * from './recipes'
export * from './water'
export * from './meals'
export * from './body'
export * from './program'
export * from './lifecycle'
export { setActiveUserId } from './internal'
