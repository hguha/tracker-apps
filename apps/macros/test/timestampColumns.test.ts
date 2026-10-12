import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMESTAMP_COLUMNS } from '@tracker-engine/local-first'
import { TIMESTAMP_COLUMNS } from '@/sync/backend'

const MIGRATIONS = join(__dirname, '../supabase/migrations')

const timestamptzColumns = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) =>
      [...readFileSync(join(MIGRATIONS, file), 'utf8').matchAll(/(\w+)\s+timestamptz/g)].map(
        (match) => match[1]!,
      ),
    )

describe('timestamp columns', () => {
  it('converts every timestamptz column the migrations create', () => {
    const converted = new Set([...DEFAULT_TIMESTAMP_COLUMNS, ...TIMESTAMP_COLUMNS])
    expect(timestamptzColumns().filter((column) => !converted.has(column))).toEqual([])
  })
})
