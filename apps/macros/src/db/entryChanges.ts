import type { DBCore, DBCoreMutateRequest, DBCoreTable, Middleware } from 'dexie'

let changedDays = new Set<string>()
let changedAll = false

function markDay(value: unknown): void {
  const day = (value as { day?: unknown } | undefined)?.day
  if (typeof day === 'string') changedDays.add(day)
}

async function markPrevious(table: DBCoreTable, req: DBCoreMutateRequest): Promise<void> {
  const keys =
    req.type === 'delete'
      ? req.keys
      : req.type === 'put'
        ? (req.keys ?? req.values.map((value) => table.schema.primaryKey.extractKey?.(value)))
        : []
  const present = keys.filter((key) => key !== undefined)
  if (present.length === 0) return
  const previous = await table.getMany({ trans: req.trans, keys: present })
  previous.forEach(markDay)
}

export const entryChangeTracker: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'entryChangeTracker',
  create: (down) => ({
    ...down,
    table: (name) => {
      const table = down.table(name)
      if (name !== 'logEntries') return table
      return {
        ...table,
        mutate: async (req) => {
          if (req.type === 'deleteRange') {
            changedAll = true
          } else {
            try {
              await markPrevious(table, req)
            } catch {
              changedAll = true
            }
            if (req.type !== 'delete') req.values.forEach(markDay)
          }
          return table.mutate(req)
        },
      }
    },
  }),
}

export function takeEntryChanges(): { all: boolean; days: Set<string> } {
  const taken = { all: changedAll, days: changedDays }
  changedAll = false
  changedDays = new Set()
  return taken
}
