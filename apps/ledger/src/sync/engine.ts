// Ledger's engine = the shared engine, wired with Ledger's schema + deps. Identical
// pattern to REPutation's src/sync/engine.ts — different schema, same class.

import { SyncEngine as CoreSyncEngine } from '@tracker-engine/local-first'
import type { SyncBackend } from '@tracker-engine/local-first'
import { ledgerSyncSchema } from './ledgerSchema'
import { ledgerSyncDeps } from './deps'

export class LedgerSyncEngine extends CoreSyncEngine {
  constructor(backend: SyncBackend) {
    super(backend, ledgerSyncSchema, ledgerSyncDeps())
  }
}
