// The one data-access boundary (§5.6): no component imports Dexie directly. Split
// by domain into the modules below and re-exported here, so `import * as repo`
// still sees the whole surface.

export * from './outbox'
export * from './profile'
export * from './exercises'
export * from './workouts'
export * from './summaries'
export * from './sets'
export * from './records'
export * from './templates'
export * from './bodyMetrics'
export * from './maintenance'
