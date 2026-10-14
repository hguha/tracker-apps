import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keysToSnake } from '@tracker-engine/local-first/columnCase'
import { db } from '@/db'
import * as repo from '@/data/repository'

const MIGRATIONS = join(__dirname, '../supabase/migrations')

const profileColumns = (): Set<string> => {
  const sql = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))
    .join('\n')
  const created = /create table profiles \(([\s\S]*?)\n\);/i.exec(sql)?.[1] ?? ''
  const fromCreate = [...created.matchAll(/^\s+(\w+)\s/gm)].map((m) => m[1]!)
  const fromAlter = [...sql.matchAll(/alter table profiles([\s\S]*?);/gi)].flatMap((m) =>
    [...m[1]!.matchAll(/add column (?:if not exists )?(\w+)/gi)].map((c) => c[1]!),
  )
  return new Set([...fromCreate, ...fromAlter])
}

describe('profile columns', () => {
  it('has a server column for every field a profile push sends', async () => {
    repo.setActiveUserId('local-user')
    await repo.ensureProfile()
    const row = (await db.profiles.toArray())[0]!
    const columns = profileColumns()
    expect(columns.has('display_name')).toBe(true)
    expect(Object.keys(keysToSnake(row as unknown as Record<string, unknown>)).filter((key) => !columns.has(key))).toEqual([])
  })
})
