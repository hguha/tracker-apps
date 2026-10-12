export class BackupParseError extends Error {}

export function parseBackupObject(json: string, notABackup: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new BackupParseError("That file isn't valid JSON.")
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BackupParseError(notABackup)
  }
  return parsed as Record<string, unknown>
}

export const backupRows = <Row extends { id: string }>(value: unknown): Row[] =>
  (Array.isArray(value) ? value : []).filter(
    (row): row is Row =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as { id?: unknown }).id === 'string' &&
      (row as { id: string }).id !== '',
  )

export interface BackupTable {
  table: string
  store: { bulkPut(rows: never[]): Promise<unknown> }
  rows: { id: string }[]
  isSynced?: boolean
}

export async function importBackupRows(options: {
  tables: BackupTable[]
  inTransaction: (work: () => Promise<void>) => Promise<unknown>
  enqueue: (table: string, rowId: string) => Promise<void>
}): Promise<void> {
  await options.inTransaction(async () => {
    for (const { table, store, rows, isSynced = true } of options.tables) {
      if (rows.length === 0) continue
      await store.bulkPut(rows as never[])
      if (!isSynced) continue
      for (const row of rows) await options.enqueue(table, row.id)
    }
  })
}
