import type {
  DeadLetterEntry,
  DeadLetterPort,
  OutboxPort,
  SyncDeps,
  SyncStatePort,
} from './types'
/**
 * The Dexie-shaped wiring every app repeats: three tables, a transaction runner, an
 * enqueue and a log tag. Extracted because it was identical in three apps apart from
 * which database it pointed at.
 */
export interface DexieSyncTables {
  outbox: OutboxPort & {
    add(entry: Omit<DeadLetterEntry, 'seq'> | object): Promise<unknown>
  }
  deadLetter: DeadLetterPort & { add(entry: Omit<DeadLetterEntry, 'seq'>): Promise<unknown> }
  syncState: SyncStatePort
  /** Runs the dead-letter move as one transaction over outbox + deadLetter. */
  transaction<T>(run: () => Promise<T>): Promise<T>
}

export function createSyncDeps(config: {
  tables: DexieSyncTables
  enqueue: SyncDeps['enqueue']
  tag: string
  reportError?: SyncDeps['reportError']
}): SyncDeps {
  const { tables } = config
  return {
    outbox: tables.outbox,
    deadLetter: tables.deadLetter,
    syncState: tables.syncState,
    moveToDeadLetter: (seq, entry) =>
      tables.transaction(async () => {
        await tables.deadLetter.add(entry)
        await tables.outbox.delete(seq)
      }),
    enqueue: config.enqueue,
    reportError:
      config.reportError ?? ((tag, error) => console.warn(`[${config.tag}] ${tag}`, error)),
  }
}
