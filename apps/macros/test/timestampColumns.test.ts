import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMESTAMP_COLUMNS } from '@tracker-engine/local-first'
import { tableToPostgres } from '@tracker-engine/local-first/columnCase'
import { TIMESTAMP_COLUMNS } from '@/sync/backend'
import { macroSyncSchema } from '@/sync/macroSchema'

const MIGRATIONS = join(__dirname, '../supabase/migrations')
const SYNCED = new Set(macroSyncSchema.tables.map(tableToPostgres))

const syncedTimestamptzColumns = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) => readFileSync(join(MIGRATIONS, file), 'utf8').split(';'))
    .filter((statement) => {
      const table = /(?:create|alter) table (?:if not exists )?(\w+)/i.exec(statement)?.[1]
      return table !== undefined && SYNCED.has(table)
    })
    .flatMap((statement) => [...statement.matchAll(/(\w+)\s+timestamptz/g)].map((m) => m[1]!))

describe('timestamp columns', () => {
  it('converts every timestamptz column on a synced table', () => {
    const columns = syncedTimestamptzColumns()
    const converted = new Set([...DEFAULT_TIMESTAMP_COLUMNS, ...TIMESTAMP_COLUMNS])
    expect(columns).toEqual(expect.arrayContaining(['eaten_at', 'verified_at', 'reached_at', 'target_at']))
    expect(columns.filter((column) => !converted.has(column))).toEqual([])
  })
})
