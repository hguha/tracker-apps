import { SyncEngine, type SyncBackend } from '@tracker-engine/local-first'
import { macroSyncSchema } from './macroSchema'
import { macroSyncDeps } from './deps'

export class MacroSyncEngine extends SyncEngine {
  constructor(backend: SyncBackend) {
    super(backend, macroSyncSchema, macroSyncDeps())
  }
}
