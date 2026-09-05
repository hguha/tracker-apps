import { db } from '@/db'
import { createWriteQueue, type WritableRowStore } from '@tracker-engine/local-first'

// Client-authored synced tables only; `profile` is device-local (see repository).
const WRITE_STORES: Record<string, WritableRowStore> = {
  entries: db.entries as unknown as WritableRowStore,
  categories: db.categories as unknown as WritableRowStore,
  budgets: db.budgets as unknown as WritableRowStore,
  rules: db.rules as unknown as WritableRowStore,
  categoryOverrides: db.categoryOverrides as unknown as WritableRowStore,
}

const writes = createWriteQueue({
  queue: {
    findByRow: (table, rowId) =>
      db.outbox.where('[table+rowId]').equals([table, rowId]).first(),
    add: (entry) => db.outbox.add(entry as never),
    update: (seq, changes) => db.outbox.update(seq, changes),
    delete: (seq) => db.outbox.delete(seq),
  },
  store: (table) => WRITE_STORES[table],
})

export const { enqueue, patch } = writes
export { newId } from '@tracker-engine/local-first'
