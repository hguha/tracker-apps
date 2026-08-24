// App wiring for the generic SyncEngine (@tracker-engine/local-first): binds REPutation's
// SyncSchema and Dexie/service deps so every call site keeps constructing
// `new SyncEngine(backend)` — or `new SyncEngine(backend, schema)` — unchanged.

import { SyncEngine as CoreSyncEngine } from '@tracker-engine/local-first'
import type { SyncBackend } from './backend'
import type { SyncSchema } from './schema'
import { repSyncSchema } from './repSchema'
import { appSyncDeps } from './deps'

export class SyncEngine extends CoreSyncEngine {
  constructor(backend: SyncBackend, schema: SyncSchema = repSyncSchema) {
    super(backend, schema, appSyncDeps())
  }
}

// Back-compat re-exports for callers importing these from '@/sync/engine'.
export { backoffMs } from '@tracker-engine/local-first'
export type { DrainResult } from '@tracker-engine/local-first'
export const SYNCED_TABLES = repSyncSchema.tables
