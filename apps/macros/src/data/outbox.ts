import { db } from '@/db'
import { createWriteQueue, type WritableRowStore } from '@tracker-engine/local-first'

// Client-authored synced tables only. `foods` is server-authored (pull-only) and `device` is
// device-local, so neither can be written through here.
const WRITE_STORES: Record<string, WritableRowStore> = {
  profiles: db.profiles as unknown as WritableRowStore,
  logEntries: db.logEntries as unknown as WritableRowStore,
  customFoods: db.customFoods as unknown as WritableRowStore,
  bodyWeights: db.bodyWeights as unknown as WritableRowStore,
  waterLogs: db.waterLogs as unknown as WritableRowStore,
  recipes: db.recipes as unknown as WritableRowStore,
  mealTemplates: db.mealTemplates as unknown as WritableRowStore,
  programs: db.programs as unknown as WritableRowStore,
  checkIns: db.checkIns as unknown as WritableRowStore,
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

export const { enqueue, forget, patch } = writes
export { newId } from '@tracker-engine/local-first'
